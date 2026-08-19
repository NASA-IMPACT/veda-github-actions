// The small repeated atoms: state pill, label chip, board-field chip, assignee avatar.
// All of them render DATA colour, so all of them go through colors.ts rather than a theme token.

import { chipStyle, KIND_ICON, optionHex, personColor, STATE_HEX } from "../colors";
import type { BoardItem, FieldDef, FieldValue, Person } from "../types";
import { fieldText } from "../filter";

export function StateBadge({ item }: { item: BoardItem }) {
  const label = item.draft && item.state === "open" ? "draft" : item.state;
  const hex = STATE_HEX[label] ?? STATE_HEX.open;
  return (
    <span className="chip state" style={chipStyle(hex)} title={`${item.kind} · ${label}`}>
      <span aria-hidden>{KIND_ICON[item.kind]}</span> {label}
    </span>
  );
}

export function LabelChip({
  name,
  color,
  onClick,
}: {
  name: string;
  color: string;
  onClick?: () => void;
}) {
  const style = chipStyle(color);
  if (!onClick) return <span className="chip" style={style}>{name}</span>;
  return (
    <button type="button" className="chip clickable" style={style} onClick={onClick}
            title={`Filter by label:${name}`}>
      {name}
    </button>
  );
}

/** A board field value. Single-select options keep GitHub's colour; other types read as chrome. */
export function FieldChip({
  field,
  value,
  onClick,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onClick?: () => void;
}) {
  const text = fieldText(value);
  if (!text) return null;
  const option = field.options?.find((o) => o.name === text);
  const style = option ? chipStyle(optionHex(option.color)) : undefined;
  const className = option ? "chip" : "chip plain";
  const title = `Filter by ${field.name}:${text}`;
  if (!onClick) return <span className={className} style={style}>{text}</span>;
  return (
    <button type="button" className={`${className} clickable`} style={style} onClick={onClick} title={title}>
      {text}
    </button>
  );
}

export function Avatar({
  person,
  login,
  size = 20,
  onClick,
}: {
  person?: Person;
  login: string;
  size?: number;
  onClick?: () => void;
}) {
  const color = personColor(login);
  const initials = (person?.name || login).slice(0, 2).toUpperCase();
  const body = person?.avatar ? (
    // `&s=` asks GitHub for a right-sized image instead of the full-resolution original.
    <img src={`${person.avatar}&s=${size * 2}`} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="avatar-fallback" style={{ background: color }}>{initials}</span>
  );
  const title = person?.name && person.name !== login ? `${person.name} (${login})` : login;
  if (!onClick) return <span className="avatar" style={{ width: size, height: size }} title={title}>{body}</span>;
  return (
    <button type="button" className="avatar clickable" style={{ width: size, height: size }}
            title={`Filter by assignee:${login}`} onClick={onClick} aria-label={`Filter by ${title}`}>
      {body}
    </button>
  );
}

/** Sub-issue completion, as a bar plus its numbers — the board's own "3/7" made scannable. */
export function SubProgress({ sub }: { sub: { total: number; completed: number } }) {
  const pct = sub.total ? Math.round((sub.completed / sub.total) * 100) : 0;
  return (
    <span className="subprog" title={`${sub.completed} of ${sub.total} sub-issues closed`}>
      <span className="subprog-track">
        <span className="subprog-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="subprog-num">
        {sub.completed}/{sub.total}
      </span>
    </span>
  );
}
