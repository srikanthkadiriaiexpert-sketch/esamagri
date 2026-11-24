import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['rounded-2xl border border-slate-200 bg-white shadow-card', className].join(' ')} {...rest} />;
}

export function CardBody({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['p-4', className].join(' ')} {...rest} />;
}
