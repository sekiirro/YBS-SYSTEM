import React from 'react';
import { cn } from '@/lib/utils';

// Keep one set of controls and one table in the DOM. On compact screens,
// column headings become visible labels beside each cell.
function labelText(node) {
  return React.Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return child;
    return React.isValidElement(child) ? labelText(child.props.children) : '';
  }).join(' ').trim();
}

export default function ResponsiveTable({ children, className, ...props }) {
  const sections = React.Children.toArray(children);
  const head = sections.find((child) => child.type === 'thead');
  const headingRow = React.Children.toArray(head?.props.children).find((child) => child.type === 'tr');
  const labels = React.Children.toArray(headingRow?.props.children).map((cell) => labelText(cell.props.children));
  return (
    <table {...props} role="table" className={cn('ybs-responsive-table', className)}>
      {sections.map((section) => {
        if (section.type !== 'tbody') return section;
        return React.cloneElement(section, { role: 'rowgroup' }, React.Children.map(section.props.children, (row) => {
          if (!React.isValidElement(row) || row.type !== 'tr') return row;
          return React.cloneElement(row, { role: 'row' }, React.Children.toArray(row.props.children).map((cell, index) => {
            if (!React.isValidElement(cell) || cell.type !== 'td') return cell;
            return React.cloneElement(cell, { role: 'cell', 'data-label': cell.props.colSpan > 1 ? undefined : labels[index] }, <div className="ybs-cell-value">{cell.props.children}</div>);
          }));
        }));
      })}
    </table>
  );
}
