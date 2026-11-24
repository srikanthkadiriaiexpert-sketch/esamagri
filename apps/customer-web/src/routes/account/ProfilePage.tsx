import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { Button } from '../../design-system/Button';
import { Input } from '../../design-system/Input';
import { Alert } from '../../design-system/Alert';
import { LoadingState, ErrorState } from '../../design-system/StateViews';
import { useToast } from '../../design-system/ToastProvider';
import { useResource } from '../../lib/api/resource';
import { ApiError, NetworkError } from '../../lib/api/client';
import { fetchMyProfile, updateMyProfile, type CustomerProfile } from '../../lib/api/customer-api';

/**
 * Edit the customer's own profile (STEP 9, spec ACC-1).
 *
 * Editable: name, quarter block, quarter number, landmark. That is the
 * complete approved set — there is no field here for Aadhaar, PAN,
 * service number, rank, unit or family details, and none is to be added
 * without separate approval.
 *
 * Mobile number is shown read-only with an explanation: it is the
 * identity STEP 6 authenticates against, so changing it is account
 * recovery rather than a profile edit. The policy for that change is a
 * NEW BUSINESS DECISION REQUIRED item surfaced during STEP 9 —
 * proposed/open, not ratified and not implemented — so the screen says
 * so plainly instead of offering a control that would fail.
 *
 * Validation mirrors the server's, but the server remains authoritative:
 * a field-level rejection from the API is surfaced here rather than
 * assumed impossible.
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const loaded = useResource<CustomerProfile>(() => fetchMyProfile(), undefined, [reloadKey]);

  const [name, setName] = useState('');
  const [quarterBlock, setQuarterBlock] = useState('');
  const [quarterNumber, setQuarterNumber] = useState('');
  const [landmark, setLandmark] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the form once the profile arrives. `profile` is the stable
  // dependency the linter can check; the setters are referenced inside
  // and never change identity.
  const profile = loaded.status === 'success' ? loaded.data : null;
  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setQuarterBlock(profile.residence?.quarterBlock ?? '');
    setQuarterNumber(profile.residence?.quarterNumber ?? '');
    setLandmark(profile.residence?.landmark ?? '');
  }, [profile]);

  const validate = useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (name.trim().length === 0) next.name = 'Please enter your name.';
    if (name.trim().length > 120) next.name = 'Name must be 120 characters or fewer.';
    // The residence pair is written together — the frozen table requires
    // both columns — so either give both or neither.
    const hasBlock = quarterBlock.trim().length > 0;
    const hasNumber = quarterNumber.trim().length > 0;
    if (hasBlock !== hasNumber) {
      const message = 'Enter both the block and the quarter number.';
      if (!hasBlock) next.quarterBlock = message;
      if (!hasNumber) next.quarterNumber = message;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [name, quarterBlock, quarterNumber]);

  const onSave = useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      await updateMyProfile({
        name: name.trim(),
        ...(quarterBlock.trim() && quarterNumber.trim()
          ? {
              quarterBlock: quarterBlock.trim(),
              quarterNumber: quarterNumber.trim(),
              landmark: landmark.trim(),
            }
          : {}),
      });
      toast.showToast({ tone: 'success', title: 'Profile updated' });
      navigate('/account');
    } catch (err: unknown) {
      setFormError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }, [name, quarterBlock, quarterNumber, landmark, validate, toast, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header title="Your profile" showBack onBack={() => navigate('/account')} />
      <main className="mx-auto w-full max-w-app px-4 pt-4">
        {loaded.status === 'loading' ? <LoadingState /> : null}
        {loaded.status === 'error' || loaded.status === 'not_implemented' ? (
          <ErrorState
            variant={loaded.status === 'error' && loaded.error instanceof ApiError && loaded.error.status === 401 ? 'session_expired' : 'error'}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : null}

        {loaded.status === 'success' ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            {formError ? <Alert tone="danger" title="Couldn't save">{formError}</Alert> : null}

            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              maxLength={120}
              autoComplete="name"
            />

            <Input
              label="Mobile number"
              value={loaded.data.mobileNumber}
              readOnly
              disabled
              hint="Your mobile number is how you sign in. Contact the facility to change it."
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-slate-800">Quarter / residence</p>
              <div className="flex flex-col gap-3">
                <Input
                  label="Block"
                  value={quarterBlock}
                  onChange={(e) => setQuarterBlock(e.target.value)}
                  error={errors.quarterBlock}
                  maxLength={60}
                  placeholder="e.g. Block 4"
                />
                <Input
                  label="Quarter number"
                  value={quarterNumber}
                  onChange={(e) => setQuarterNumber(e.target.value)}
                  error={errors.quarterNumber}
                  maxLength={60}
                  placeholder="e.g. Qtr 12"
                />
                <Input
                  label="Landmark (optional)"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>

            <Button type="submit" accent="green" fullWidth loading={saving}>
              Save changes
            </Button>
          </form>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Turns a transport/API failure into something a customer can act on —
 * never a stack trace, never a database message. The backend already
 * refuses to emit those; this is the client-side half of the same rule.
 */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status === 403) return 'You do not have permission to change this.';
    if (err.status === 400) return 'Please check the details you entered and try again.';
    return 'Something went wrong saving your profile. Please try again.';
  }
  if (err instanceof NetworkError) return 'We could not reach the server. Check your connection and try again.';
  return 'Something went wrong saving your profile. Please try again.';
}
