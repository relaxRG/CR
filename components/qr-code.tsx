/**
 * QRCode component using qrcode library + react-native-svg
 * Renders a QR code for the given value
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import QRCodeLib from "qrcode";

interface QRCodeProps {
  value: string;
  size?: number;
  backgroundColor?: string;
  foregroundColor?: string;
}

export function QRCode({ value, size = 160, backgroundColor = "#FFFFFF", foregroundColor = "#000000" }: QRCodeProps) {
  const [svgPath, setSvgPath] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    QRCodeLib.toString(value, { type: "svg", margin: 1, width: size }, (err, svgString) => {
      if (err || !svgString) return;
      // Extract path data from SVG string
      const pathMatch = svgString.match(/<path[^>]*d="([^"]+)"/);
      if (pathMatch?.[1]) {
        setSvgPath(pathMatch[1]);
      }
    });
  }, [value, size]);

  if (!svgPath) return <View style={{ width: size, height: size, backgroundColor }} />;

  return (
    <View style={{ width: size, height: size, backgroundColor, borderRadius: 8, padding: 4 }}>
      <Svg width={size - 8} height={size - 8} viewBox={`0 0 ${size} ${size}`}>
        <Rect width={size} height={size} fill={backgroundColor} />
        <Path d={svgPath} fill={foregroundColor} />
      </Svg>
    </View>
  );
}
