import { useNavigate } from 'react-router-dom';
import { Header } from '../design-system/Header';

/** Bottom-nav "Orders" tab target — RIK and PIF order contexts are strictly separate (Section 7). */
export function OrdersChooserPage() {
  const navigate = useNavigate();
  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Orders" />
      <main className="flex flex-col gap-3 p-4">
        <button type="button" onClick={() => navigate('/rik/orders')} className="rounded-2xl bg-brand-blueLight p-4 text-left">
          <p className="text-sm font-bold text-brand-blueDark">My RIK Orders</p>
        </button>
        <button type="button" onClick={() => navigate('/pif/orders')} className="rounded-2xl bg-brand-greenLight p-4 text-left">
          <p className="text-sm font-bold text-brand-greenDark">My PIF Orders</p>
        </button>
      </main>
    </div>
  );
}
