import React, { useEffect, useState } from 'react';
import type { IImportProfile } from '@/types';
import { DEFAULT_IMPORT_PROFILE } from '@/constants';

interface ImportProfilesModalProps {
  profiles: IImportProfile[];
  activeProfileId: string;
  onSave: (profiles: IImportProfile[], activeProfileId: string) => void;
  onClose: () => void;
}

function makeProfile(): IImportProfile {
  return { ...DEFAULT_IMPORT_PROFILE, id: `profile-${Date.now()}`, name: 'New profile', domains: [] };
}

export const ImportProfilesModal: React.FC<ImportProfilesModalProps> = ({ profiles, activeProfileId, onSave, onClose }) => {
  const [draftProfiles, setDraftProfiles] = useState(profiles);
  const [editingProfileId, setEditingProfileId] = useState(profiles[0]?.id || DEFAULT_IMPORT_PROFILE.id);
  const profile = draftProfiles.find(candidate => candidate.id === editingProfileId) || draftProfiles[0];

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  const updateProfile = (updates: Partial<IImportProfile>) => {
    if (!profile) return;
    setDraftProfiles(current => current.map(candidate => candidate.id === profile.id ? { ...candidate, ...updates } : candidate));
  };

  const addProfile = () => {
    const next = makeProfile();
    setDraftProfiles(current => [...current, next]);
    setEditingProfileId(next.id);
  };

  const removeProfile = () => {
    if (!profile || draftProfiles.length <= 1) return;
    const next = draftProfiles.filter(candidate => candidate.id !== profile.id);
    setDraftProfiles(next);
    setEditingProfileId(next[0]!.id);
  };

  if (!profile) return null;

  return (
    <>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div className="modal fade show d-block" role="dialog" aria-modal="true" aria-labelledby="importProfilesTitle" tabIndex={-1}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content" style={{ background: 'var(--glass-bg-strong, var(--stash-card-bg, #252525))', color: 'var(--text, #eee)', borderColor: 'var(--glass-border, #444)' }}>
            <div className="modal-header" style={{ borderColor: 'var(--glass-border, #444)' }}>
              <h5 className="modal-title" id="importProfilesTitle">Import Profiles</h5>
              <button type="button" className="btn-close btn-close-white" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body d-flex flex-column gap-3">
              <div className="d-flex gap-2">
                <select className="form-select" value={profile.id} onChange={event => setEditingProfileId(event.target.value)} aria-label="Profile to edit">
                  {draftProfiles.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
                <button type="button" className="btn btn-outline-primary text-nowrap" onClick={addProfile}>Add profile</button>
                <button type="button" className="btn btn-outline-danger" onClick={removeProfile} disabled={draftProfiles.length <= 1}>Delete</button>
              </div>

              <label className="form-label mb-0">
                Profile name
                <input className="form-control mt-1" value={profile.name} onChange={event => updateProfile({ name: event.target.value })} maxLength={60} />
              </label>
              <label className="form-label mb-0">
                Matching domains
                <textarea className="form-control mt-1" rows={2} value={profile.domains.join('\n')} onChange={event => updateProfile({ domains: event.target.value.split(/[\n,]/).map(domain => domain.trim()).filter(Boolean) })} placeholder={'example.com\n*.another-site.com'} />
                <small className="text-muted">One host per line. A matching profile is selected automatically for new URLs.</small>
              </label>

              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" id="profileAutoImport" checked={profile.autoImport} onChange={event => updateProfile({ autoImport: event.target.checked })} />
                <label className="form-check-label" htmlFor="profileAutoImport">Automatically import without opening the metadata editor</label>
              </div>

              <fieldset>
                <legend className="fs-6">Create missing Stash metadata</legend>
                <div className="d-flex flex-wrap gap-3">
                  <div className="form-check"><input className="form-check-input" type="checkbox" id="profileCreatePerformers" checked={profile.createPerformers} onChange={event => updateProfile({ createPerformers: event.target.checked })} /><label className="form-check-label" htmlFor="profileCreatePerformers">Performers</label></div>
                  <div className="form-check"><input className="form-check-input" type="checkbox" id="profileCreateTags" checked={profile.createTags} onChange={event => updateProfile({ createTags: event.target.checked })} /><label className="form-check-label" htmlFor="profileCreateTags">Tags</label></div>
                  <div className="form-check"><input className="form-check-input" type="checkbox" id="profileCreateStudios" checked={profile.createStudios} onChange={event => updateProfile({ createStudios: event.target.checked })} /><label className="form-check-label" htmlFor="profileCreateStudios">Studios</label></div>
                </div>
                <small className="text-muted">When disabled, existing entities still link; missing names are skipped.</small>
              </fieldset>

              <label className="form-label mb-0">
                Filename template
                <input className="form-control mt-1" value={profile.filenameTemplate} onChange={event => updateProfile({ filenameTemplate: event.target.value })} placeholder="{title}" />
                <small className="text-muted">Tokens: {'{title}'}, {'{site}'}, {'{date}'}, {'{id}'}</small>
              </label>

              <label className="form-label mb-0">
                After import
                <select className="form-select mt-1" value={profile.postImportAction} onChange={event => updateProfile({ postImportAction: event.target.value as IImportProfile['postImportAction'] })}>
                  <option value="none">No additional action</option>
                  <option value="identify">Run Stash Identify</option>
                  <option value="scrape_url">Scrape metadata from source URL</option>
                </select>
              </label>
            </div>
            <div className="modal-footer" style={{ borderColor: 'var(--glass-border, #444)' }}>
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => onSave(draftProfiles, draftProfiles.some(candidate => candidate.id === activeProfileId) ? activeProfileId : draftProfiles[0]!.id)}>Save profiles</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
