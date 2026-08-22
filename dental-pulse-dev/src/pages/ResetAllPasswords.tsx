import { useState } from "react";

export default function ResetAllPasswords() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  const handleReset = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch(`${backendUrl}/api/dev/reset-all-passwords`);

      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || "Unknown error");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 12, padding: 32, maxWidth: 500, width: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", textAlign: "center" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a1d2e", margin: "0 0 8px" }}>
          DentPulse Enterprise
        </h2>
        <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px" }}>
          Reset all Supabase user passwords to <code style={{ background: "#fee2e2", padding: "2px 8px", borderRadius: 4, color: "#dc2626", fontSize: 18 }}>123456</code>
        </p>

        <button
          onClick={handleReset}
          disabled={loading}
          style={{
            background: loading ? "#9ca3af" : "#dc2626",
            color: "#fff",
            border: "none",
            padding: "14px 40px",
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Resetting..." : "Reset All Passwords"}
        </button>

        {result && (
          <div style={{ marginTop: 20, padding: 16, background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
            <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: 8 }}>Done</div>
            <div style={{ fontSize: 14, color: "#333" }}>
              Users updated: <strong>{result.users_updated}</strong>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 20, padding: 16, background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
            <div style={{ fontWeight: 600, color: "#dc2626" }}>Error: {error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
