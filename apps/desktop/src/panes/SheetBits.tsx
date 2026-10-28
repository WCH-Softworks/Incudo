/**
 * Small pieces every sheet renderer on the desktop shares — ADR 0126: a section's label with its explanation behind an
 * "i", and a row's value with its mark drawn as dots.
 */

import { rowAside, type SheetRow, type SheetSectionView } from '@incudo/ui';

import { InfoTip } from './InfoTip.tsx';

/** A section's label, with its explanation behind an "i" when it has one (ADR 0126 decision 2). */
export function SectionHead({ section, level = 3 }: { section: Pick<SheetSectionView, 'label' | 'description'>; level?: 3 | 4 | 5 }): React.JSX.Element {
  const Heading = `h${level}` as const;
  return (
    <Heading className="sheet-section-head">
      {section.label}
      {section.description && <InfoTip label={`About ${section.label}`}>{section.description}</InfoTip>}
    </Heading>
  );
}

/**
 * A row's mark as dots on screen, "proficient" one, "expertise" two, and its word for print and a screen reader
 * (ADR 0126 decision 10).
 */
export function MarkDots({ mark }: { mark: NonNullable<SheetRow['mark']> }): React.JSX.Element {
  return (
    <span className="sheet-mark" title={mark.label}>
      <span className="sheet-mark-dots" aria-hidden="true">
        {Array.from({ length: Math.max(1, Math.min(mark.count, 3)) }, (_, at) => (
          <span key={at} className="sheet-mark-dot" />
        ))}
      </span>
      <span className="sheet-mark-word"> ({mark.label})</span>
    </span>
  );
}

/** A row's value, its mark as dots, and what is beside it. */
export function RowValue({ row }: { row: SheetRow }): React.JSX.Element {
  const aside = rowAside({ ...row, mark: undefined });
  return (
    <>
      {row.value}
      {row.mark && <MarkDots mark={row.mark} />}
      {aside !== undefined && <span className="sheet-beside"> ({aside})</span>}
    </>
  );
}
