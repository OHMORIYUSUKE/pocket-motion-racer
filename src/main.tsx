import React from 'react';
import ReactDOM from 'react-dom/client';
import GameSession from '@/components/game-session';
import '@/app/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameSession />
  </React.StrictMode>,
);
