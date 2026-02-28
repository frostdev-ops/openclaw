interface BottomBarProps {
  gatewayProtocol?: string;
  nodeVersion?: string;
}

export function BottomBar({ gatewayProtocol, nodeVersion }: BottomBarProps) {
  return (
    <div className="bottombar">
      <span>OpenClaw Node Client</span>
      {gatewayProtocol && (
        <>
          <span className="bottombar-sep" />
          <span>Protocol {gatewayProtocol}</span>
        </>
      )}
      {nodeVersion && (
        <>
          <span className="bottombar-sep" />
          <span className="mono">{nodeVersion}</span>
        </>
      )}
    </div>
  );
}
