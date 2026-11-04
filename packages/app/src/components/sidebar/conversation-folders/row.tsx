import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { ChevronDown, ChevronRight, Ellipsis, type LucideIcon } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenuTrigger, type MenuPageDefinition } from "@/components/ui/dropdown-menu";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { MenuTriggerState } from "@/components/ui/menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { isWeb } from "@/constants/platform";
import { density } from "@/styles/density";

interface ConversationFolderRowProps {
  label: string;
  depth: number;
  icon: LucideIcon;
  testID: string;
  expanded?: boolean;
  detail?: string;
  onPress: () => void;
  menu?: ReactNode;
  pages?: MenuPageDefinition[];
  color?: string;
}

export function ConversationFolderRow({
  label,
  depth,
  icon,
  testID,
  expanded,
  detail,
  onPress,
  menu,
  pages,
  color,
}: ConversationFolderRowProps) {
  const { t } = useTranslation();
  const accessibilityState = expanded === undefined ? undefined : { expanded };
  const accessibilityLabel = detail ? `${label}, ${detail}` : label;
  const content = (
    <>
      {expanded !== undefined ? (
        <DensityIcon
          icon={expanded ? ChevronDown : ChevronRight}
          size="sm"
          color="foregroundMuted"
        />
      ) : null}
      {color ? <View style={[styles.colorDot, { backgroundColor: color }]} /> : null}
      <DensityIcon icon={icon} size="sm" color="foregroundMuted" />
      <Text numberOfLines={1} style={styles.title}>
        {label}
      </Text>
      {detail ? (
        <Text numberOfLines={1} style={styles.detail}>
          {detail}
        </Text>
      ) : null}
    </>
  );
  const rowStyle = useCallback(
    ({ hovered, pressed, open }: { hovered?: boolean; pressed: boolean; open?: boolean }) => [
      styles.row,
      Boolean(menu) && styles.rowContent,
      { paddingStart: 8 + Math.min(depth, 8) * 18 },
      (hovered || pressed || open) && styles.highlight,
    ],
    [depth, menu],
  );
  const trigger = {
    onPress,
    accessibilityRole: "button" as const,
    accessibilityState,
    ...(isWeb && expanded !== undefined ? { "aria-expanded": expanded } : {}),
    accessibilityLabel,
    testID,
  };

  if (!menu) {
    return (
      <PressHighlight {...trigger} style={rowStyle} highlightStyle={styles.highlight}>
        {content}
      </PressHighlight>
    );
  }

  return (
    <ContextMenu>
      <View style={styles.rowWithMenu}>
        <ContextMenuTrigger {...trigger} style={rowStyle} highlightStyle={styles.highlight}>
          {content}
        </ContextMenuTrigger>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.conversationFolders.actionsFor", { name: label })}
          testID={`${testID}-actions`}
          style={menuButtonStyle}
        >
          <DensityIcon icon={Ellipsis} size="sm" color="foregroundMuted" />
        </DropdownMenuTrigger>
      </View>
      <ContextMenuContent sheetTitle={label} pages={pages}>
        {menu}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function menuButtonStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.menuButton, (hovered || pressed || open) && styles.highlight];
}

const styles = StyleSheet.create((theme) => ({
  rowWithMenu: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowContent: { flex: 1 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  row: {
    minWidth: 0,
    minHeight: density.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingEnd: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  highlight: { backgroundColor: theme.colors.surfaceSidebarHover },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  detail: {
    flexShrink: 1,
    maxWidth: "35%",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  menuButton: {
    minHeight: density.rowHeight,
    width: density.rowHeight,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
  },
}));
