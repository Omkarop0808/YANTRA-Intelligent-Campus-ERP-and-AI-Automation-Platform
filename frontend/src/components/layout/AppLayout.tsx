import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useSidebarState } from '../../lib/useSidebarState';
import { useRole } from '../../lib/useRole';

interface AppLayoutProps {
  children: React.ReactNode;
  /** Page identity shown in the unified TopBar's left slot. */
  pageIcon?: React.ReactNode;
  pageTitle?: React.ReactNode;
  pageBreadcrumb?: React.ReactNode;
  /** Page-specific actions (filters, primary buttons) for the TopBar's middle slot. */
  pageActions?: React.ReactNode;
  /** When no title/icon provided, fall back to the global search box. */
  showSearch?: boolean;
  /** Optional bottom action bar pinned below the scroll area. */
  bottomBar?: React.ReactNode;
  /** Background colour override for the main scroll area. */
  background?: string;
  /** When true the content area is padded; set false to manage padding yourself. */
  padded?: boolean;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  pageIcon, pageTitle, pageBreadcrumb, pageActions, showSearch,
  bottomBar, background, padded = true,
}) => {
  const { collapsed, toggle, close } = useSidebarState();
  const { role } = useRole();
  const location = useLocation();

  // Auto-close mobile drawer whenever route changes
  useEffect(() => {
    if (window.innerWidth <= 768) {
      close();
    }
  }, [location.pathname, close]);

  const useSearch = showSearch ?? (!pageTitle && !pageIcon);

  return (
    <div className="dashboard-layout">
      {!collapsed && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <Sidebar
        isCollapsed={collapsed}
        onMenuToggle={toggle}
        role={role}
      />
      <div className="dashboard-main" style={background ? { background } : undefined}>
        <TopBar
          icon={pageIcon}
          title={pageTitle}
          breadcrumb={pageBreadcrumb}
          actions={pageActions}
          showSearch={useSearch}
          onMenuToggle={toggle}
        />
        <div
          className="dashboard-content"
          style={padded ? undefined : { padding: 0 }}
        >
          {children}
        </div>
        {bottomBar}
      </div>
    </div>
  );
};
