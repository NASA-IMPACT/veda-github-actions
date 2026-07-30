import { useRef, useState } from "react";
import type { Status } from "../types";
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from "../colors";
import { useClickAway } from "../useClickAway";

interface Props {
  teams: string[];
  selectedTeams: Set<string>;
  onTeams: (next: Set<string>) => void;
  statuses: Set<Status>;
  onStatuses: (next: Set<Status>) => void;
}

export default function Filters({ teams, selectedTeams, onTeams, statuses, onStatuses }: Props) {
  const [openTeam, setOpenTeam] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const teamRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useClickAway(teamRef, () => setOpenTeam(false), openTeam);
  useClickAway(statusRef, () => setOpenStatus(false), openStatus);

  function toggleTeam(t: string) {
    const next = new Set(selectedTeams);
    next.has(t) ? next.delete(t) : next.add(t);
    onTeams(next);
  }
  function toggleStatus(s: Status) {
    const next = new Set(statuses);
    next.has(s) ? next.delete(s) : next.add(s);
    onStatuses(next);
  }

  const teamLabel = selectedTeams.size === teams.length ? "All teams" : `${selectedTeams.size} teams`;
  const statusLabel = statuses.size === STATUS_ORDER.length ? "All statuses" : `${statuses.size} statuses`;

  return (
    <>
      <div className="control" ref={teamRef}>
        <button className="btn" onClick={() => setOpenTeam((o) => !o)}>🏷️ {teamLabel} ▾</button>
        {openTeam && (
          <div className="popover panel">
            <div className="actions">
              <button onClick={() => onTeams(new Set(teams))}>All</button>
              <button onClick={() => onTeams(new Set())}>Clear</button>
            </div>
            {teams.map((t) => (
              <label key={t} className="row">
                <input type="checkbox" checked={selectedTeams.has(t)} onChange={() => toggleTeam(t)} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="control" ref={statusRef}>
        <button className="btn" onClick={() => setOpenStatus((o) => !o)}>🎨 {statusLabel} ▾</button>
        {openStatus && (
          <div className="popover panel">
            <div className="actions">
              <button onClick={() => onStatuses(new Set(STATUS_ORDER))}>All</button>
              <button onClick={() => onStatuses(new Set(STATUS_ORDER.filter((s) => s === "unavailable" || s === "planned_time_off" || s === "holiday")))}>
                Out only
              </button>
            </div>
            {STATUS_ORDER.map((s) => (
              <label key={s} className="row">
                <input type="checkbox" checked={statuses.has(s)} onChange={() => toggleStatus(s)} />
                <span className="sw" style={{ background: STATUS_COLOR[s] }} />
                <span>{STATUS_LABEL[s]}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
