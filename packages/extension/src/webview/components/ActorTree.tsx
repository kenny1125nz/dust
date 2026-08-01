import { useState } from 'preact/hooks';
import type { ActorTreeNode } from '../../actors/schema';

interface ActorTreeProps {
  root: ActorTreeNode | null;
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}

export function ActorTree({ root, selected, disabled, onSelect }: ActorTreeProps) {
  if (!root) {
    return (
      <div className="dust-tree" role="tree" aria-label="Actors">
        Loading actors…
      </div>
    );
  }
  return (
    <div className="dust-tree" role="tree" aria-label="Actors">
      {root.children.map((child) => (
        <ActorTreeNodeView key={child.name} node={child} depth={0} selected={selected} disabled={disabled} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface ActorTreeNodeViewProps {
  node: ActorTreeNode;
  depth: number;
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}

function ActorTreeNodeView({ node, depth, selected, disabled, onSelect }: ActorTreeNodeViewProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isActor = node.actorId !== undefined;
  const hasChildren = node.children.length > 0;
  const isSelected = isActor && node.actorId === selected;

  const select = (): void => {
    if (node.actorId !== undefined) {
      onSelect(node.actorId);
    }
  };

  return (
    <div>
      <div
        className={isSelected ? 'dust-tree-row dust-tree-selected' : 'dust-tree-row'}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="dust-tree-chevron"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="dust-tree-chevron dust-tree-leaf" aria-hidden="true">
            ·
          </span>
        )}
        {isActor ? (
          <button type="button" className="dust-tree-label" disabled={disabled} onClick={select}>
            {node.name}
          </button>
        ) : (
          <span className="dust-tree-label">{node.name}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <ActorTreeNodeView key={child.name} node={child} depth={depth + 1} selected={selected} disabled={disabled} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
