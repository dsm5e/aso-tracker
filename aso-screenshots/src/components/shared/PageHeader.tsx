import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  /** One-line subtitle; the full text stays available as a tooltip. */
  sub?: string;
  /** Small element before the title (e.g. a back link). */
  lead?: ReactNode;
  actions?: ReactNode;
}

/** Page header shared by the wizard screens: title + actions in one row,
 *  subtitle clamped to one line (tooltip carries the rest). Sticky inside the
 *  content scroller; the subtitle folds away once the page scrolls (polish.css). */
export function PageHeader({ title, sub, lead, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <div className="page-head-title-row">
          {lead}
          <h1 className="ds-page-title">{title}</h1>
        </div>
        {sub && <p className="ds-page-sub page-head-sub" title={sub}>{sub}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}
