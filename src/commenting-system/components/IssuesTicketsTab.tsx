import * as React from 'react';
import { Tab, TabTitleText, Tabs } from '@patternfly/react-core';
import { GitHubIssuesTab } from './GitHubIssuesTab';
import { JiraTab } from './JiraTab';

export const IssuesTicketsTab: React.FunctionComponent = () => {
  const [issuesSubTab, setIssuesSubTab] = React.useState<string | number>('jira');

  return (
    <Tabs
      activeKey={issuesSubTab}
      onSelect={(_event, tabKey) => setIssuesSubTab(tabKey)}
      aria-label="Issue trackers"
      variant="secondary"
    >
      <Tab eventKey="jira" title={<TabTitleText>Atlassian Jira</TabTitleText>}>
        <div style={{ paddingTop: '0.5rem' }}>
          <JiraTab />
        </div>
      </Tab>
      <Tab eventKey="github" title={<TabTitleText>GitHub</TabTitleText>}>
        <div style={{ paddingTop: '0.5rem' }}>
          <GitHubIssuesTab />
        </div>
      </Tab>
    </Tabs>
  );
};
