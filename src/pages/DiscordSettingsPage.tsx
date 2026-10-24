import { PageHeader } from '@/components/PageHeader';
import { useDiscord } from '@/extension/useDiscord';
import { DiscordIntegration, DiscordSettings } from './IntegrationSettings';
import { settingsUi } from './settingsStyles';

/** Discord Rich Presence through the local Discord app: the connection, then how the card reads. */
export default function DiscordSettingsPage() {
  const status = useDiscord();
  return (
    <div className={settingsUi.centered}>
      <PageHeader title="Discord" />
      <div className={settingsUi.body}>
        <section className={settingsUi.group}>
          <div className={settingsUi.integrationPlain}>
            <span className={settingsUi.integrationName}>Discord App</span>
            <DiscordIntegration />
          </div>
        </section>
        {status.state === 'ready' && !status.discord.connected && (
          <p className={settingsUi.footer}>
            Connect talks to the Discord desktop app running on this computer (Discord, Canary, PTB or Vesktop) over its local
            Rich Presence socket. Discord must be open; nothing is sent to Discord’s servers by Prismix itself.
          </p>
        )}
        {status.state === 'ready' && status.discord.connected && (
          <>
            <h2 className={settingsUi.sectionHeader}>Presence</h2>
            <DiscordSettings />
          </>
        )}
      </div>
    </div>
  );
}
