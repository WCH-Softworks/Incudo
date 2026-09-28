/**
 * A candidate's sanitized description, or a plain note that it has none. What the description embeds is put in place
 * from the same index it is read from (`expandDescription`, ADR 0069) before it is sanitized.
 */

import { useMemo } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';
import { expandDescription } from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

export function CandidateDescription({
  id,
  elements,
}: {
  id: ElementId;
  elements: ElementIndex;
}): React.JSX.Element {
  const element = elements.get(id);
  const html = useMemo(
    () => (element?.description ? sanitizeDescriptionHtml(expandDescription(element, elements)) : undefined),
    [element, elements],
  );
  return html ? (
    <div className="picker-description" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <p className="hint">No description available.</p>
  );
}
