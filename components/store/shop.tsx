import React from "react";
import StoreInventoryScreen from "@/components/store/inventory";

/**
 * 店铺模块仅承载门店运营物资：杯具、餐具、日用品与设备。
 * 酒水和食材仍归“库存”模块，避免经营耗材与原料库存混杂。
 */
export default function StoreShopScreen() {
  return <StoreInventoryScreen mode="shop" />;
}
