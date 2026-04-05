import { Navigate } from 'react-router-dom';

export function SyncRunsPage() {
  return <Navigate to="/logs?tab=sync" replace />;
}
