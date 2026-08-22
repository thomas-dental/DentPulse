import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats()
      .then((data) => setStats(data))
      .catch(() => setStats({ total_users: 0, total_appointments: 0, total_patients: 0 }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Welcome back to DentPulse SuperAdmin</p>
      </div>

      {loading ? (
        <div className="loading-spinner">Loading stats...</div>
      ) : (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">👥</div>
            <div className="stat-info">
              <h3>{stats?.total_users || 0}</h3>
              <p>Total Users</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📅</div>
            <div className="stat-info">
              <h3>{stats?.total_appointments || 0}</h3>
              <p>Appointments</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🏥</div>
            <div className="stat-info">
              <h3>{stats?.total_patients || 0}</h3>
              <p>Patients</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
