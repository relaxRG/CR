// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "wineglass.fill": "local-bar",
  "folder.fill": "folder",
  "chevron.up": "keyboard-arrow-up",
  "chevron.down": "keyboard-arrow-down",
  "arrow.down.to.line": "vertical-align-bottom",
  "arrow.up.to.line": "vertical-align-top",
  "rectangle.split.2x1": "compare",
  "arrow.right": "arrow-forward",
  "slider.horizontal.3": "tune",
  "plus": "add",
  "line.3.horizontal": "drag-handle",
  "doc.on.clipboard": "content-paste",
  "books.vertical.fill": "liquor",
  "flask.fill": "science",
  "star.fill": "star",
  "star": "star-border",
  "magnifyingglass": "search",
  "xmark.circle.fill": "cancel",
  "book.fill": "menu-book",
  "doc.fill": "description",
  "doc.badge.plus": "note-add",
  "camera.fill": "photo-camera",
  "photo.fill": "photo",
  "circle": "radio-button-unchecked",
  "pencil": "edit",
  "trash.fill": "delete",
  "chevron.left": "chevron-left",
  "snowflake": "ac-unit",
  "xmark": "close",
  "checkmark": "check",
  "checkmark.circle": "radio-button-unchecked",
  "checkmark.circle.fill": "check-circle",
  "minus.circle.fill": "remove-circle",
  "plus.circle.fill": "add-circle",
  "sparkles": "auto-awesome",
  "link": "link",
  "arrow.triangle.2.circlepath": "sync",
  "exclamationmark.triangle.fill": "warning",
  "person.crop.circle.fill": "account-circle",
  "tag.fill": "label",
  "square.and.arrow.down.fill": "download",
  "globe": "language",
  "icloud.fill": "cloud",
  "info.circle.fill": "info",
  "heart": "favorite-border",
  "heart.fill": "favorite",
  "trash": "delete-outline",
  "book": "book",
  "arrow.up.arrow.down": "swap-vert",
  "line.3.horizontal.decrease": "filter-list",
  "text.cursor": "text-fields",
  "list.bullet": "format-list-bulleted",
  "bookmark": "bookmark-border",
  "bookmark.fill": "bookmark",
  "storefront.fill": "storefront",
  "storefront": "storefront",
  "tag": "sell",
  "checkmark.square.fill": "check-box",
  "square": "check-box-outline-blank",
  "ellipsis": "more-horiz",
  "ellipsis.circle": "more-horiz",
  "arrow.right.arrow.left": "swap-horiz",
  "folder.badge.plus": "create-new-folder",
  "eye": "visibility",
  "eye.slash": "visibility-off",
  "dollarsign.circle.fill": "monetization-on",
  "cart.fill": "shopping-cart",
  "list.dash": "reorder",
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
