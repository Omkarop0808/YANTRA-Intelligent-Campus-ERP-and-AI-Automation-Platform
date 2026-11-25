import React from 'react';

interface DeadlineItem {
  title: string;
  course: string;
  date: string;
  instructor: string;
  isUrgent?: boolean;
  badge?: string;
}

interface DeadlineListProps {
  items: DeadlineItem[];
}

export const DeadlineList: React.FC<DeadlineListProps> = ({ items }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {items.map((item, index) => (
        <div key={index} style={{ 
          border: '1px solid var(--border-color)', 
          borderRadius: 'var(--radius-md)', 
          padding: '1rem',
          borderLeft: item.isUrgent ? '4px solid #DC2626' : '1px solid var(--border-color)',
          backgroundColor: 'white'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{item.title}</div>
              {item.badge && (
                <span
                  style={{
                    backgroundColor: '#D1FAE5',
                    color: '#065F46',
                    padding: '0.12rem 0.45rem',
                    borderRadius: '9999px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: item.isUrgent ? '#DC2626' : 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
              {item.date.split(',').map((part, i) => (
                <React.Fragment key={i}>
                  {part}
                  {i === 0 && <br />}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {item.course} • {item.instructor}
          </div>
        </div>
      ))}
    </div>
  );
};
