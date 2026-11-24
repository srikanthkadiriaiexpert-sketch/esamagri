import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../design-system/StateViews';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="app-shell flex min-h-screen items-center justify-center">
      <EmptyState title="Page not found" description="The page you're looking for doesn't exist." action={{ label: 'Go home', onClick: () => navigate('/') }} />
    </div>
  );
}
