import { ExternalLink, FileKey2 } from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { useImportClientFile } from '@renderer/hooks/useAccounts'

const CONSOLE_URL = 'https://console.cloud.google.com/apis/credentials'

/** Shown until a Desktop-app OAuth client file has been imported. */
export function GoogleSetupCard({ problem }: { problem: string | null }): React.JSX.Element {
  const importFile = useImportClientFile()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileKey2 className="size-5" aria-hidden />
          Connect ChannelDeck to Google
        </CardTitle>
        <CardDescription>
          ChannelDeck uses your own Google Cloud project to talk to YouTube. Set it up once:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            In Google Cloud Console, create a project and enable the{' '}
            <span className="text-foreground">YouTube Data API v3</span>.
          </li>
          <li>
            Set up the OAuth consent screen (External), then set its publishing status to{' '}
            <span className="text-foreground">In production</span>. In “Testing” mode Google signs
            you out of every channel after 7 days.
          </li>
          <li>
            Under Credentials, create an OAuth client ID of type{' '}
            <span className="text-foreground">Desktop app</span> and download its JSON.
          </li>
          <li>Import that file here. It&apos;s stored only on this Mac.</li>
        </ol>
      </CardContent>
      <CardFooter className="gap-3">
        <Button onClick={() => importFile.mutate()} disabled={importFile.isPending}>
          <FileKey2 aria-hidden />
          Import Google client file
        </Button>
        <Button variant="ghost" asChild>
          <a href={CONSOLE_URL} target="_blank" rel="noreferrer">
            Open Google Cloud Console
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </CardFooter>
    </Card>
  )
}
