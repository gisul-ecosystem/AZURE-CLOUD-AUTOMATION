import DashboardView from '../components/DashboardView';
import { listRequests } from '../services/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let requests = [];
  let error = '';

  try {
    requests = await listRequests();
  } catch (fetchError) {
    error = fetchError.message;
  }

  return <DashboardView requests={requests} error={error} lastUpdated={new Date().toISOString()} />;
}
