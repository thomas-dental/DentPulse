import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Topbar() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h2 className="topbar-title">SuperAdmin Panel</h2>
      </div>

      <div className="topbar-right" ref={dropdownRef}>
        <button className="topbar-profile" onClick={() => setOpen((o) => !o)}>
          <div className="topbar-avatar">
            {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'A'}
          </div>
          <div className="topbar-user-info">
            <span className="topbar-user-name">{user?.full_name || 'Super Admin'}</span>
            <span className="topbar-user-role">{user?.role || 'superadmin'}</span>
          </div>
          <span className={`topbar-chevron ${open ? 'open' : ''}`}>▾</span>
        </button>

        {open && (
          <div className="topbar-dropdown">
            <div className="topbar-dropdown-header">
              <div className="topbar-dropdown-avatar">
                {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'A'}
              </div>
              <div>
                <div className="topbar-dropdown-name">{user?.full_name || 'Super Admin'}</div>
                <div className="topbar-dropdown-email">{user?.email}</div>
              </div>
            </div>
            <div className="topbar-dropdown-divider"></div>
            <button className="topbar-dropdown-item" onClick={() => { setOpen(false); logout(); }}>
              <span>🚪</span>
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
