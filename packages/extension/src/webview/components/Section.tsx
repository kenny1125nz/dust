import type { ComponentChildren } from 'preact';

export interface SectionProps {
  label: string;
  children?: ComponentChildren;
}

export function Section({ label, children }: SectionProps) {
  return (
    <section className="dust-section">
      <h2 className="dust-section-label">{label}</h2>
      {children}
    </section>
  );
}
