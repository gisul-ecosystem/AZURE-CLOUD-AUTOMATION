
const db = require('../db/postgres');
const AppError = require('../utils/AppError');

const {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  roleAssignmentIdFromSeed
} = require('../provisioners/azure/roleProvisioner');

const getRequestContext = async (client, requestId) => {
  const result = await client.query(
    `
    SELECT
      id,
      account_count,
      status,
      azure_resource_group_name
    FROM requests
    WHERE id=$1
    FOR UPDATE
    `,
    [requestId]
  );

  return result.rows[0];
};

const getAzureUsersForRequest = async (client, requestId) => {
  const result = await client.query(
    `
    SELECT
      id,
      request_id,
      azure_user_id,
      username
    FROM azure_users
    WHERE request_id=$1
      AND COALESCE(is_deleted,false)=false
    ORDER BY username
    `,
    [requestId]
  );

  return result.rows;
};

const getSelectedRolesForRequest = async (client, requestId) => {
  const result = await client.query(
    `
    SELECT
      service_id,
      azure_role
    FROM request_service_roles
    WHERE request_id=$1
    `,
    [requestId]
  );

  return result.rows;
};


const getExistingAssignments = async (
client,
requestId,
userId
)=>{

const result=
await client.query(

`
SELECT
azure_role

FROM user_role_assignments

WHERE request_id=$1
AND user_id=$2
`,

[
requestId,
userId
]

);

return result.rows;

};




// FIXED INSERT

const upsertUserAssignment =
async(
client,
data
)=>{

await client.query(

`
INSERT INTO user_role_assignments(

assignment_id,
request_id,
user_id,
azure_role,
scope,
assigned_at,
created_at

)

SELECT

$1,
$2,
$3,
$4,
$5,
$6,
NOW()

WHERE NOT EXISTS(

SELECT 1

FROM user_role_assignments

WHERE request_id=$2
AND user_id=$3
AND azure_role=$4

)
`,

[

data.assignmentId,
data.requestId,
data.userId,
data.azureRole,
data.scope,
data.assignedAt

]

);

};





const getUserRoleAssignmentsForRequest =
async(
requestId
)=>{

const result=
await db.query(

`
SELECT

ura.assignment_id,
ura.azure_role,
ura.scope,
ura.assigned_at,

au.username,
au.azure_user_id,

s.name AS service_name

FROM user_role_assignments ura

LEFT JOIN azure_users au
ON au.id=ura.user_id

LEFT JOIN request_service_roles rsr
ON rsr.request_id=ura.request_id
AND rsr.azure_role=ura.azure_role

LEFT JOIN services s
ON s.id=rsr.service_id

WHERE ura.request_id=$1

ORDER BY
au.username,
s.name,
ura.azure_role
`,

[
requestId
]

);

return result.rows;

};





const provisionRolesForRequest =
async(
requestId
)=>{

const client=
await db.connect();

try{

await client.query(
'BEGIN'
);

const request=
await getRequestContext(
client,
requestId
);

if(!request){
throw new AppError(
'Request not found',
404
);
}

const users=
await getAzureUsersForRequest(
client,
requestId
);

const roles=
await getSelectedRolesForRequest(
client,
requestId
);

const {
authorizationClient,
subscriptionId
}=
createAuthorizationClient();

const resourceGroupScope=
buildResourceGroupScope(
subscriptionId,
request.azure_resource_group_name
);

let assigned=0;

for(const user of users){

const existing=
await getExistingAssignments(
client,
requestId,
user.id
);

for(const role of roles){

if(
existing.some(
x=>
x.azure_role===
role.azure_role
)
){
continue;
}

const roleScope=resourceGroupScope;

const definition=
await findMatchingRoleDefinition(
authorizationClient,
roleScope,
role.azure_role
);

if(!definition){
continue;
}

const assignmentId=
roleAssignmentIdFromSeed(
`${requestId}-${user.id}-${role.service_id}-${definition.id}`
);

try{

await createRoleAssignmentWithRetry(

authorizationClient,

roleScope,

assignmentId,

{
principalId:
user.azure_user_id,

roleDefinitionId:
definition.id,

principalType:
'User'
},

requestId

);

}
catch(error){

if(
error?.statusCode===409
||
error?.code==='RoleAssignmentExists'
){

console.log(
'ROLE_EXISTS'
);

}
else{
throw error;
}

}

await upsertUserAssignment(
client,
{
requestId,
userId:user.id,
assignmentId,
azureRole:role.azure_role,
scope:roleScope,
assignedAt:new Date()
}
);

assigned++;

}

}

await client.query(
'COMMIT'
);

return{

success:true,

usersProcessed:
users.length,

rolesAssigned:
assigned

};

}
catch(error){

await client.query(
'ROLLBACK'
);

throw error;

}
finally{

client.release();

}

};

module.exports={
provisionRolesForRequest,
getUserRoleAssignmentsForRequest
};

