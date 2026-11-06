import React, { useEffect } from 'react';

export interface IDuplicateSceneCandidate {
  id: string;
  title?: string;
  url: string;
}

interface DuplicateSceneModalProps {
  scene: IDuplicateSceneCandidate;
  onSkip: () => void;
  onOpen: () => void;
  onAddAnyway: () => void;
}

export const DuplicateSceneModal: React.FC<DuplicateSceneModalProps> = ({ scene, onSkip, onOpen, onAddAnyway }) => {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return <>
    <div className="modal-backdrop fade show" />
    <div className="modal fade show d-block" role="dialog" aria-modal="true" aria-labelledby="duplicateSceneTitle" tabIndex={-1}>
      <div className="modal-dialog">
        <div className="modal-content" style={{ background: 'var(--glass-bg-strong, var(--stash-card-bg, #252525))', color: 'var(--text, #eee)', borderColor: 'var(--glass-border, #444)' }}>
          <div className="modal-header" style={{ borderColor: 'var(--glass-border, #444)' }}>
            <h5 className="modal-title" id="duplicateSceneTitle">Scene already exists</h5>
            <button type="button" className="btn-close btn-close-white" aria-label="Close" onClick={onSkip} />
          </div>
          <div className="modal-body">
            <p className="mb-2">Stash already has a scene with this source URL:</p>
            <strong className="d-block mb-2">{scene.title || `Scene ${scene.id}`}</strong>
            <a href={scene.url} target="_blank" rel="noopener noreferrer" className="small text-break">{scene.url}</a>
            <p className="mt-3 mb-0 text-muted">Open the existing scene, skip this URL, or add another copy anyway.</p>
          </div>
          <div className="modal-footer flex-wrap" style={{ borderColor: 'var(--glass-border, #444)' }}>
            <button type="button" className="btn btn-outline-secondary" onClick={onSkip}>Skip</button>
            <button type="button" className="btn btn-outline-primary" onClick={onOpen}>Open existing</button>
            <button type="button" className="btn btn-primary" onClick={onAddAnyway}>Add anyway</button>
          </div>
        </div>
      </div>
    </div>
  </>;
};
