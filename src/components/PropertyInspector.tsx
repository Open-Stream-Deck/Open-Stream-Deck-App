import { t } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { pluginFile } from "../plugins/model";
import { pluginHost } from "../plugins/host";

type Props = {
  dir: string;
  page: string;
  context: string;
};

export function PropertyInspector({ dir, page, context }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [revision, setRevision] = useState(() => pluginHost.details(dir)?.revision ?? 0);

  useEffect(
    () =>
      pluginHost.subscribe(() => {
        const next = pluginHost.details(dir)?.revision ?? 0;
        setRevision((current) => (current === next ? current : next));
      }),
    [dir],
  );

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    return pluginHost.connectInspector(context, element);
  }, [context, revision]);

  return (
    <iframe
      key={`${context}:${revision}`}
      ref={frame}
      class="property-inspector"
      sandbox="allow-scripts"
      src={pluginFile(dir, page, revision)}
      title={t("inspector.pluginSettings")}
    />
  );
}
