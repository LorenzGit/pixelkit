import React, { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';

/* Reusable, accessible form controls used across the panels.
   Every control accepts a `tip` — rendered as a hover/focus tooltip via the
   [data-tip] CSS so users can tell what each setting actually does. */

export function Section({ title, icon, children, action, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="section">
      {collapsible ? (
        <h2>
          <button type="button" className="sectionToggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
            {icon}<span>{title}</span>
            <ChevronRight size={14} className={'chev' + (open ? ' open' : '')} aria-hidden="true" />
          </button>
        </h2>
      ) : (
        <h2>{icon}<span>{title}</span>{action}</h2>
      )}
      {(!collapsible || open) && <div className="sectionbody" id={bodyId}>{children}</div>}
    </section>
  );
}

export function Range({ label, value, min, max, step = 1, set, suffix = '', tip }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="range">
      <span>
        <em className={tip ? 'lbl hastip' : 'lbl'} data-tip={tip}>{label}</em>
        <b>{value}{suffix}</b>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        onChange={e => set(+e.target.value)}
        style={{ background: `linear-gradient(90deg,var(--accent) ${pct}%,var(--track) ${pct}%)` }}
      />
    </label>
  );
}

// Options are [value, label] or [value, label, tip].
export function Seg({ label, value, set, options, tip }) {
  return (
    <div className="seg">
      {label && <span className={tip ? 'lbl hastip' : 'lbl'} data-tip={tip}>{label}</span>}
      <div className="segbtns" role="group" aria-label={label}>
        {options.map(([v, l, t]) => (
          <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} data-tip={t} onClick={() => set(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, icon, children, small = false, tip }) {
  return (
    <label className={'check' + (small ? ' sm' : '') + (tip ? ' hastip' : '')} data-tip={tip}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {icon}{children}
    </label>
  );
}
