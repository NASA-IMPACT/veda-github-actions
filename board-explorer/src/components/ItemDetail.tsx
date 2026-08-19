// One item, in full. Keyed by id upstream so it survives a refilter underneath it.

import { useEffect } from "react";
import { Avatar, FieldChip, LabelChip, StateBadge, SubProgress } from "./Chips";
import { fieldText } from "../filter";
import type { BoardDoc, BoardItem } from "../types";

interface Props {
  board: BoardDoc;
  item: BoardItem;
  onClose: () => void;
  onQualify: (key: string, value: string) => void;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export default function ItemDetail({ board, item, onClose, onQualify }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const qualify = (key: string, value: string) => {
    onQualify(key, value);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">
            <StateBadge item={item} />
            <h2>{item.title}</h2>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-where">
          {item.repo ? (
            <button className="linkbtn" onClick={() => qualify("repo", item.repo)}>
              {item.repo}
            </button>
          ) : (
            <span className="muted">draft item — lives only on the board</span>
          )}
          {item.number != null && <> · #{item.number}</>}
          {item.author && (
            <>
              {" "}· opened by{" "}
              <button className="linkbtn" onClick={() => qualify("author", item.author!)}>
                {item.author}
              </button>
            </>
          )}
        </p>

        <dl className="detail-grid">
          <dt>Assignees</dt>
          <dd>
            {item.assignees.length === 0 ? (
              <span className="muted">unassigned</span>
            ) : (
              <span className="detail-people">
                {item.assignees.map((login) => {
                  const person = board.people.find((p) => p.login === login);
                  return (
                    <button key={login} className="person-pill" onClick={() => qualify("assignee", login)}>
                      <Avatar login={login} person={person} size={18} />
                      {person?.name && person.name !== login ? person.name : login}
                    </button>
                  );
                })}
              </span>
            )}
          </dd>

          <dt>Labels</dt>
          <dd>
            {item.labels.length === 0 ? (
              <span className="muted">none</span>
            ) : (
              <span className="chips">
                {item.labels.map((name) => (
                  <LabelChip
                    key={name}
                    name={name}
                    color={board.labels.find((l) => l.name === name)?.color ?? "888888"}
                    onClick={() => qualify("label", name)}
                  />
                ))}
              </span>
            )}
          </dd>

          {board.fields.map((f) => {
            const text = fieldText(item.fields[f.name]);
            return (
              <div key={f.name} className="detail-pair">
                <dt>{f.name}</dt>
                <dd>
                  {text ? (
                    <FieldChip field={f} value={item.fields[f.name]} onClick={() => qualify(f.name, text)} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </dd>
              </div>
            );
          })}

          {item.milestone && (
            <div className="detail-pair">
              <dt>Milestone</dt>
              <dd>
                <button className="chip plain clickable" onClick={() => qualify("milestone", item.milestone!)}>
                  {item.milestone}
                </button>
              </dd>
            </div>
          )}

          {item.issue_type && (
            <div className="detail-pair">
              <dt>Type</dt>
              <dd>
                <button className="chip plain clickable" onClick={() => qualify("type", item.issue_type!)}>
                  {item.issue_type}
                </button>
              </dd>
            </div>
          )}

          {item.sub && (
            <div className="detail-pair">
              <dt>Sub-issues</dt>
              <dd>
                <SubProgress sub={item.sub} />
              </dd>
            </div>
          )}

          {item.parent && (
            <div className="detail-pair">
              <dt>Parent</dt>
              <dd>
                <a href={item.parent.url} target="_blank" rel="noreferrer">
                  #{item.parent.number} {item.parent.title}
                </a>
              </dd>
            </div>
          )}

          {item.diff && (
            <div className="detail-pair">
              <dt>Diff</dt>
              <dd>
                <span className="diffstat">
                  <span className="add">+{item.diff.additions}</span>{" "}
                  <span className="del">−{item.diff.deletions}</span>{" "}
                  <span className="muted">
                    across {item.diff.files} file{item.diff.files === 1 ? "" : "s"}
                  </span>
                  {item.review_decision && <span className="muted"> · review {item.review_decision}</span>}
                </span>
              </dd>
            </div>
          )}

          <div className="detail-pair">
            <dt>Dates</dt>
            <dd className="muted">
              created {when(item.created)} · updated {when(item.updated)}
              {item.closed && ` · ${item.state === "merged" ? "merged" : "closed"} ${when(item.closed)}`}
              {item.state_reason && ` (${item.state_reason.replace("_", " ")})`}
            </dd>
          </div>
        </dl>

        {item.body_excerpt && (
          <div className="detail-body">
            <h3>Description</h3>
            {/* An excerpt, not the whole body — the generator truncates it to keep the payload small. */}
            <p>{item.body_excerpt}</p>
            <p className="muted excerpt-note">Excerpt — open in GitHub for the full description.</p>
          </div>
        )}

        {item.url && (
          <a className="btn primary open-gh" href={item.url} target="_blank" rel="noreferrer">
            Open in GitHub ↗
          </a>
        )}
      </div>
    </div>
  );
}
