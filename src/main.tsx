import React from 'react';
import ReactDOM from 'react-dom/client';
import DriveGame from '@/components/drive-game';
import '@/app/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><DriveGame /></React.StrictMode>,
);
