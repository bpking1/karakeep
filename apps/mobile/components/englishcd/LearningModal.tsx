import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";

export function LearningModal({
  title,
  onClose,
  children,
  fill = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  fill?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        }}
        className="items-center justify-center"
      >
        <Pressable
          accessibilityLabel="关闭学习卡片"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        />
        <View
          className="w-[94%] max-w-xl gap-3 rounded-3xl bg-background p-4"
          style={{
            maxHeight: "94%",
            flexShrink: 1,
            ...(fill ? { height: "94%" } : {}),
          }}
        >
          <Text className="text-xl font-semibold">{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
