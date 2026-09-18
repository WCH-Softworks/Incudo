/** A candidate's sanitized description, or a plain note that it has none. */

import { useMemo } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';

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
    () => (element?.description ? sanitizeDescriptionHtml(element.description) : undefined),
    [element],
  );
  return html ? (
    <div className="picker-description" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <p className="hint">No description available.</p>
  );
}
