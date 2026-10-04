import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, Page, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { HIGHLIGHTS, PROFILE_KEY, getProfile } from "@/modules/admin/data/property";
import { TextEditor } from "./TextEditor";

/* The hotel's highlights (D27-257): five texts guests read on their page,
   behind the code. Plain text; a blank line starts a new paragraph. */
export default function Highlights() {
  const code = useUi((s) => s.hotelId);
  const q = useQuery({ queryKey: PROFILE_KEY(code), queryFn: () => getProfile(code), enabled: Boolean(code) });

  return (
    <Page>
      <PageHeader title="Highlights"
        description="What guests read about the hotel on their page, after the code. Leave one blank and it is not shown." />
      <Card>
        <CardBody>
          {q.isLoading ? <Skeleton className="h-48 w-full" /> : (
            <Tabs defaultValue="about">
              <TabsList>
                {HIGHLIGHTS.map(([kind, label]) => <TabsTrigger key={kind} value={kind}>{label}</TabsTrigger>)}
              </TabsList>
              {HIGHLIGHTS.map(([kind, label]) => (
                <TabsContent key={kind} value={kind} className="pt-4">
                  <TextEditor code={code} kind={kind} label={label} value={q.data?.texts[kind] ?? ""}
                    hint="Plain words; a blank line starts a new paragraph." />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
