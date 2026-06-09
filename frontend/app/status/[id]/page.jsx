import { notFound } from 'next/navigation';
import ProvisionStatusClient from '../../../components/ProvisionStatusClient';
import { fetchProvisionSnapshot } from '../../../services/api';

export const dynamic = 'force-dynamic';

const isValidId = (value) => /^\d+$/.test(String(value || ''));

export default async function StatusPage({ params }) {
  const resolvedParams = await Promise.resolve(params);
  const requestId = String(resolvedParams?.id || '').trim();

  if (!isValidId(requestId)) {
    notFound();
  }

  let initialSnapshot = null;

  try {
    initialSnapshot = await fetchProvisionSnapshot(requestId);
  } catch (error) {
    initialSnapshot = {
      request: null,
      provision: null,
      users: null,
      roles: null,
      credentials: null,
      error: error.message
    };
  }

  return <ProvisionStatusClient requestId={requestId} initialSnapshot={initialSnapshot} />;
}
