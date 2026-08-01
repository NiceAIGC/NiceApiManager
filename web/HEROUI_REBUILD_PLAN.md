# Native HeroUI Reconstruction Plan

## Objective

Replace Ant Design and Ant Design Icons with a native HeroUI implementation while preserving every backend contract, route, filter, mutation, validation rule, and synchronization workflow.

## Non-negotiable constraints

- No `antd`, `@ant-design/icons`, Ant Design types, selectors, compatibility adapters, or API shims remain in the web application.
- All interactive controls render from `@heroui/react`; icons render from `lucide-react`.
- Existing API clients, TypeScript payload types, routes, query keys, and service behavior remain unchanged.
- Each native form owns a typed React state model and explicit validation; Ant Form semantics are not recreated.
- Tables use HeroUI `Table` with local sorting, selection, detail expansion, and HeroUI `Pagination` where the existing API returns a list or offset page.

## Work breakdown

1. Foundation
   - Add HeroUI, Framer Motion, Lucide, and Tailwind configuration.
   - Mount `HeroUIProvider` and `ToastProvider`; delete Ant providers.
   - Establish native reusable primitives only for repeated application concepts: status chip, table frame, pagination, field grid, confirmation modal, and toast helpers.

2. Shell and authentication
   - Rebuild desktop navigation, responsive mobile drawer, logout behavior, login, and auth loading entirely with HeroUI.

3. Read-only and dashboard views
   - Rebuild dashboard filters, KPI cards, time range controls, batch-sync progress, charts, group ratios, pricing, and logs.

4. Instance workflows
   - Rebuild the instance table: client-side selection, sorting, expansion, page slicing, and mutation actions.
   - Rebuild individual and batch instance modals using typed controlled state, including auth mode, proxy testing, advanced settings, tags, alert channels, and payload normalization.

5. Notification and settings workflows
   - Rebuild channels and all three rule lists as typed controlled arrays, retaining conditional fields and Apprise URL construction.
   - Rebuild runtime settings and the password dialog.

6. Cleanup and acceptance
   - Delete old Ant components and CSS. Confirm the dependency tree and source tree have no Ant references.
   - Validate `npm ci`, production build, native browser login and representative authenticated workflows, then validate Docker build.

## Acceptance matrix

- Authentication: status check, login error/success, logout, protected-route redirect.
- Instances: filters, sorting, selection, expansion, single/batch create/edit/delete, proxy test, single/batch sync and retry.
- Dashboard: filters, period selection, aggregate cards, chart rendering, batch sync.
- Data pages: group/pricing/log filters, tabs, mode switches, pagination.
- Notifications: notification settings, all channel types, add/remove each rule family, conditional advanced fields, save, test delivery, guide.
- Settings: all runtime values and password change.
- Delivery: no Ant package/import/style remains and Docker produces the same static frontend route assets.
