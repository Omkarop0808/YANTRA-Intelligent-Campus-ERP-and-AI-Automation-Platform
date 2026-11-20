import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Menu, User } from 'lucide-react';
import { toast } from 'react-toastify';
import { Logo } from '../ui/Logo';
import {
  adminNav, adminTools, studentNav, teacherNav, teacherTools, teacherQuickActions, type NavItem,
} from '../../lib/navConfig';
import type { Role } from '../../lib/useRole';
import { useAuth } from '../../lib/auth/AuthContext';

interface SidebarProps {
  isCollapsed: boolean;
  onMenuToggle: () => void;
  role?: Role;
}

const NavList: React.FC<{ items: NavItem[]; isCollapsed: boolean }> = ({ items, isCollapsed }) => (
  <>
    {items.map(item => (
      <NavLink
        key={item.path}
        to={item.path}
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        title={item.name}
      >
        {item.icon}
        {!isCollapsed && <span>{item.name}</span>}
      </NavLink>
    ))}
  </>
);

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onMenuToggle,
  role = 'student',
}) => {
  const isTeacher = role === 'teacher';
  const isAdmin = role === 'admin';
  const primaryNav = isAdmin ? adminNav : isTeacher ? teacherNav : studentNav;
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    toast.info('Signed out');
    navigate('/signin', { replace: true });
  };

  return (
    <div className={`dashboard-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo-container">
        <button onClick={onMenuToggle} className="sidebar-menu-toggle" aria-label="Toggle navigation">
          <Menu size={24} />
        </button>
        {!isCollapsed && (
          <div className="sidebar-logo-block">
            <Logo />
            <span className="sidebar-logo-tagline">
              {isAdmin ? 'Admin Console' : isTeacher ? 'Faculty Workspace' : 'Education Management'}
            </span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        <NavList items={primaryNav} isCollapsed={isCollapsed} />

        {isAdmin && (
          <div className={`sidebar-section ${isCollapsed ? 'collapsed' : ''}`}>
            {!isCollapsed && <div className="sidebar-section-title">Campus Ops</div>}
            <NavList items={adminTools} isCollapsed={isCollapsed} />
          </div>
        )}

        {isTeacher && (
          <div className={`sidebar-section ${isCollapsed ? 'collapsed' : ''}`}>
            {!isCollapsed && <div className="sidebar-section-title">Tools</div>}
            <NavList items={teacherTools} isCollapsed={isCollapsed} />
          </div>
        )}

        {isTeacher && (
          <div className={`sidebar-section ${isCollapsed ? 'collapsed' : ''}`}>
            {!isCollapsed && <div className="sidebar-section-title">Quick Actions</div>}
            <NavList items={teacherQuickActions} isCollapsed={isCollapsed} />
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Profile">
          <User size={20} />
          {!isCollapsed && <span>Profile</span>}
        </NavLink>
        <a href="/signin" onClick={handleLogout} className="nav-item" title="Logout">
          <LogOut size={20} />
          {!isCollapsed && <span>Logout</span>}
        </a>
      </div>
    </div>
  );
};
