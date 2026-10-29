import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@deckhand/ui';
import './app.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
