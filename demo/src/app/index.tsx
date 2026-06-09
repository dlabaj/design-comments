import * as React from 'react';
import '@patternfly/react-core/dist/styles/base.css';
import { BrowserRouter as Router } from 'react-router-dom';
import { AppLayout } from '@app/AppLayout/AppLayout';
import { AppRoutes } from '@app/routes';
import { CommentProvider } from '@design-comments';
import { GitHubAuthProvider } from '@design-comments';
import '@app/app.css';

const App: React.FunctionComponent = () => (
  <Router>
    <GitHubAuthProvider>
      <CommentProvider>
        <AppLayout>
          <AppRoutes />
        </AppLayout>
      </CommentProvider>
    </GitHubAuthProvider>
  </Router>
);

export default App;
