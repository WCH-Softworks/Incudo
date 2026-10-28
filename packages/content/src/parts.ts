/**
 * The parts of a source — ADR 0055.
 *
 * A source may record parts the user switched off (`ConfiguredSource.excluded`): the library leaves each out, and
 * everything under a switched-off index. The tree a user chooses from is the source's own, written by its conversion
 * (`ContentSourceInfo.parts`, read through `sourceParts`): every nested index and file, at its first mention.
 */

import type { ContentPart } from '@incudo/core';

/** One part of a source: a nested index or a file, as its parent names it. */
export type IndexTreeNode = ContentPart;
