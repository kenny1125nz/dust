import { useState } from 'preact/hooks';
import type { TargetNodePayload } from '../../surface/webviewProtocol';

interface TargetTreeProps {
  nodes: TargetNodePayload[];
}

/** Read-only display of the Explorer selection; folders expand, files are leaves. */
export function TargetTree({ nodes }: TargetTreeProps) {
  if (nodes.length === 0) {
    return <div className="dust-tree">No target selected.</div>;
  }
  return (
    <div className="dust-tree" role="tree" aria-label="Selected Target">
      {nodes.map((node) => (
        <TargetTreeNodeView key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}

interface TargetTreeNodeViewProps {
  node: TargetNodePayload;
  depth: number;
}

function TargetTreeNodeView({ node, depth }: TargetTreeNodeViewProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="dust-tree-row" style={{ paddingLeft: `${depth * 12}px` }}>
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
        <span className="dust-tree-label">{node.name}</span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TargetTreeNodeView key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
