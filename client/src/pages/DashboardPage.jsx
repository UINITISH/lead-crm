import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import StatCard from '../components/StatCard.jsx';
import PipelineFunnel from '../components/PipelineFunnel.jsx';
import ActivityFeed from '../components/ActivityFeed.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import UpcomingFollowups from '../components/UpcomingFollowups.jsx';
import ValueChart from '../components/ValueChart.jsx';
import { api } from '../lib/api.js';
import { fmtINR } from '../lib/format.js';

export default function DashboardPage({ leads, report, load, actingAs }) {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [board, setBoard] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, b, f] = await Promise.all([
        api('/dashboard-stats'), api('/activity?limit=8'), api('/leaderboard'), api('/followups?limit=6'),
      ]);
      setStats(s.stats); setActivity(a.activity || []); setBoard(b.leaderboard || []); setFollowups(f.followups || []);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function markFollowupDone(id) {
    await api('/followups/' + id, { method: 'PATCH', body: JSON.stringify({ done: true }) });
    loadAll();
  }

  const byDeveloper = {};
  leads.forEach(l => { const k = l.developer_name || '(no developer set)'; byDeveloper[k] = (byDeveloper[k] || 0) + 1; });
  const topDevelopers = Object.entries(byDeveloper).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <>
      <div className="topbar">
        <h1>Dashboard</h1>
        <div className="grow" />
        <button onClick={() => { loadAll(); load(); }}><Icon name="refresh" size={14} /> Refresh</button>
      </div>

      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}

      {(loading || !stats) ? <div className="empty">{loadError ? ' ' : 'Loading…'}</div> : (
        <>
          <div className="cards">
            <StatCard icon="users" iconBg="var(--accent-bg)" iconFg="var(--accent)" label="Total leads"
                      value={stats.total_leads} trend={stats.total_leads_trend} />
            <StatCard icon="briefcase" iconBg="var(--good-bg)" iconFg="var(--good)" label="Open pipeline"
                      value={stats.open_pipeline} trend={stats.open_pipeline_trend} />
            <StatCard icon="rupee" iconBg="var(--pro-bg)" iconFg="var(--pro)" label="Pipeline value"
                      value={fmtINR(stats.pipeline_value)} trend={stats.pipeline_value_trend} />
            <StatCard icon="target" iconBg="var(--warn-bg)" iconFg="var(--warn)" label="Conversion rate"
                      value={stats.conversion_rate + '%'} />
          </div>

          <div className="grid2" style={{ marginBottom: 20 }}>
            <div>
              <h2>Sales pipeline</h2>
              <PipelineFunnel stages={stats.stages} />
            </div>
            <div>
              <h2>Pipeline value over time</h2>
              <ValueChart data={stats.value_trend} />
            </div>
          </div>

          <div className="grid2" style={{ marginBottom: 20 }}>
            <div>
              <h2>Recent activity</h2>
              <ActivityFeed items={activity} />
            </div>
            <div>
              <h2>Rep leaderboard</h2>
              <Leaderboard rows={board} />
            </div>
          </div>

          <div className="grid2" style={{ marginBottom: 20 }}>
            <div>
              <h2>Upcoming follow-ups</h2>
              <UpcomingFollowups items={followups} onDone={markFollowupDone} />
            </div>
            <div>
              <h2>Top developers</h2>
              <div className="card">
                {topDevelopers.map(([name, n]) => (
                  <div className="list-row" key={name}>
                    <Avatar name={name} size={28} />
                    <div style={{ flex: 1, fontSize: 13 }}>{name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{n} lead{n === 1 ? '' : 's'}</div>
                  </div>
                ))}
                {!topDevelopers.length && <div className="empty">No leads yet.</div>}
              </div>
            </div>
          </div>

          <h2>By source and campaign</h2>
          <table>
            <thead><tr>
              <th>Source</th><th>Campaign</th><th>Unique</th><th>Gross</th>
              <th>Worked</th><th>Site visits</th><th>Closed</th>
            </tr></thead>
            <tbody>
              {report.map((r, i) => (
                <tr key={i}>
                  <td><span className={'pill src-' + r.source}>{r.source}</span></td>
                  <td>{r.campaign}</td>
                  <td>{r.unique_leads}</td>
                  <td className="muted">{r.gross_leads}</td>
                  <td>{r.contacted_plus}</td>
                  <td>{r.site_visits}</td>
                  <td>{r.closed}</td>
                </tr>
              ))}
              {!report.length && <tr><td colSpan={7} className="empty">No data yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
