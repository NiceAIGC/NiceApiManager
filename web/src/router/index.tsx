import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from '../layouts/AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { GroupsPage } from '../pages/GroupsPage';
import { InstancesPage } from '../pages/InstancesPage';
import { LoginPage } from '../pages/LoginPage';
import { PricingPage } from '../pages/PricingPage';
import { SyncRunsPage } from '../pages/SyncRunsPage';
import { RequireAuth } from './RequireAuth';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: 'dashboard',
            element: <DashboardPage />,
          },
          {
            path: 'instances',
            element: <InstancesPage />,
          },
          {
            path: 'groups',
            element: <GroupsPage />,
          },
          {
            path: 'pricing',
            element: <PricingPage />,
          },
          {
            path: 'sync-runs',
            element: <SyncRunsPage />,
          },
        ],
      },
    ],
  },
]);
