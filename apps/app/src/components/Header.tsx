import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { searchProducts } from "../api/client";
import { cartItemCount } from "../lib/cart";
import { browseCategories, type BrowseCategory } from "../lib/categories";
import { useLayoutMode } from "../lib/layout";
import { categoryHref, searchHref } from "../lib/product-url";
import { color } from "../lib/theme";
import { useAccountStore } from "../store/useAccountStore";
import { useCartStore } from "../store/useCartStore";
import { useSavedStore } from "../store/useSavedStore";
import { useShopStore } from "../store/useShopStore";
import { AuthDialog } from "./AuthDialog";
import { SearchField } from "./SearchField";
import { Sheet } from "./Sheet";
import { Shell } from "./Page";
import { Icon, type IconName } from "./Icon";
import { Appear, Tappable } from "./motion";
import { ProductImage } from "./ProductImage";
import { ProductLink } from "./ProductLink";
import { Banner, Heading } from "./semantic";

function AccountEntry() {
  const router = useRouter();
  const account = useAccountStore((state) => state.account);
  const [authOpen, setAuthOpen] = useState(false);

  if (account) {
    const name = account.displayName || account.email;
    return (
      <Tappable
        accessibilityRole="link"
        accessibilityLabel={`Your account, signed in as ${name}`}
        onPress={() => router.push("/account")}
        className="min-h-11 shrink-0 flex-row items-center gap-2 rounded-full pl-1.5 pr-3.5"
      >
        <View className="h-8 w-8 items-center justify-center rounded-full bg-arro-50">
          <Text className="text-[13px] font-bold leading-5 text-arro-700">
            {name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          className="max-w-[120px] text-[14px] font-semibold leading-5 text-ink-950"
        >
          {account.displayName || account.email.split("@")[0]}
        </Text>
      </Tappable>
    );
  }

  return (
    <>
      <Tappable
        accessibilityRole="button"
        accessibilityLabel="Sign in to Arro"
        onPress={() => setAuthOpen(true)}
        className="min-h-11 shrink-0 flex-row items-center gap-2 rounded-full border border-line px-4"
      >
        <Icon name="person" size={17} color={color.ink950} />
        <Text className="text-[14px] font-semibold leading-5 text-ink-950">
          Sign in
        </Text>
      </Tappable>
      <AuthDialog visible={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

/**
 * Header utility entry: an icon, a label on wide screens, and a count.
 *
 * The count is a sibling of the label, not a badge floating over the icon. A
 * bubble absolutely positioned inside a labelled pill lands between the glyph
 * and the word and reads as damage; it only makes sense when the icon is the
 * whole control.
 */
function HeaderEntry({
  icon,
  label,
  count = 0,
  active = false,
  showLabel,
  onPress,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  showLabel: boolean;
  onPress: () => void;
}) {
  const display = count > 99 ? "99+" : String(count);

  return (
    <Tappable
      accessibilityLabel={count > 0 ? `${label}, ${count}` : label}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2 rounded-full ${showLabel ? "pl-3.5 pr-3" : "w-11 justify-center"} ${active ? "bg-arro-50" : ""}`}
    >
      <View>
        <Icon
          name={icon}
          size={20}
          color={active ? color.arro600 : color.ink950}
        />
        {count > 0 && !showLabel ? (
          <View className="absolute -right-2 -top-1.5 min-w-[17px] items-center justify-center rounded-full bg-arro-600 px-1">
            <Text className="text-[10px] font-bold leading-[17px] text-white">
              {display}
            </Text>
          </View>
        ) : null}
      </View>
      {showLabel ? (
        <>
          <Text className="text-[14px] font-semibold leading-5 text-ink-950">
            {label}
          </Text>
          {count > 0 ? (
            <View className="min-w-[20px] items-center justify-center rounded-full bg-arro-600 px-1.5 py-0.5">
              <Text className="text-[11px] font-bold leading-4 text-white">
                {display}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Tappable>
  );
}

export function Header({ onOpenSearch }: { onOpenSearch: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { compact, desktop } = useLayoutMode();
  const query = useShopStore((state) => state.query);
  const setQuery = useShopStore((state) => state.setQuery);
  const submitQuery = useShopStore((state) => state.submitQuery);
  const compareCount = useShopStore((state) => state.compare.length);
  const savedCount = useSavedStore((state) => state.items.length);
  const recordQuery = useSavedStore((state) => state.recordQuery);
  const cartCount = useCartStore((state) => cartItemCount(state.lines));
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [hovered, setHovered] = useState<BrowseCategory>();
  /**
   * One representative product photograph per sub-category, fetched the first
   * time a category is opened and kept for the session.
   *
   * Arro has no category artwork of its own and will not commission stock
   * photos that go stale — the honest picture of "Coffee machines" is a coffee
   * machine a shop is selling right now. Bounded to the first four children of
   * whichever category is actually on screen, so opening the menu costs at most
   * four small calls once.
   */
  const [tiles, setTiles] = useState<Record<string, string>>({});
  const fetched = useRef(new Set<string>());

  const loadTiles = useCallback((category: BrowseCategory) => {
    if (fetched.current.has(category.query)) return;
    fetched.current.add(category.query);
    void Promise.all(
      category.children.slice(0, 4).map(async (child) => {
        try {
          const response = await searchProducts(child.query, {
            sort: "relevance",
            limit: 1,
          });
          const image = response.items.find((item) => item.imageUrl)?.imageUrl;
          return image ? ([child.query, image] as const) : undefined;
        } catch {
          return undefined;
        }
      }),
    ).then((entries) => {
      const found = Object.fromEntries(
        entries.filter((entry): entry is readonly [string, string] =>
          Boolean(entry),
        ),
      );
      if (Object.keys(found).length > 0)
        setTiles((current) => ({ ...current, ...found }));
    });
  }, []);
  const [drilled, setDrilledInto] = useState<BrowseCategory>();
  const active = hovered ?? browseCategories[0]!;

  useEffect(() => {
    if (categoriesOpen) loadTiles(active);
  }, [active, categoriesOpen, loadTiles]);
  const onHome = pathname === "/";
  const onResults = pathname.startsWith("/search");

  // The field mirrors the query only while results are on screen. Carrying a
  // finished search into a product or cart page leaves the shopper looking at a
  // box that no longer describes what they are seeing.
  useEffect(() => {
    if (!onResults) setQuery("");
  }, [onResults, pathname, setQuery]);

  const runSearch = (value = query) => {
    const next = value.trim();
    if (!next) return;
    recordQuery(next);
    submitQuery(next);
    setCategoriesOpen(false);
    setDrilledInto(undefined);
    router.push(searchHref(next));
  };

  const closeCategories = useCallback(() => {
    clickPinned.current = false;
    setCategoriesOpen(false);
    setDrilledInto(undefined);
  }, []);

  /**
   * The trigger and the panel are separate elements with a gap between them, so
   * neither one's own hover state can decide whether the menu should stay. A
   * shared grace period lets the pointer cross that gap; leaving both for longer
   * than that is the shopper saying they are done.
   */
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Hover is a preview; a click or keyboard activation is an explicit
  // disclosure and must not disappear merely because the pointer moves.
  const clickPinned = useRef(false);
  const holdOpen = useCallback(() => {
    clearTimeout(leaveTimer.current);
    setCategoriesOpen(true);
  }, []);
  const releaseOpen = useCallback(() => {
    if (clickPinned.current) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(closeCategories, 140);
  }, [closeCategories]);

  const toggleCategories = useCallback(() => {
    clearTimeout(leaveTimer.current);
    if (categoriesOpen && clickPinned.current) {
      closeCategories();
      return;
    }
    clickPinned.current = true;
    setCategoriesOpen(true);
  }, [categoriesOpen, closeCategories]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const openCategory = (categoryQuery: string) => {
    setQuery(categoryQuery);
    setDrilledInto(undefined);
    runSearch(categoryQuery);
  };

  /** Top-level categories open their own page rather than searching their name. */
  const openCategoryPage = (categoryQuery: string) => {
    closeCategories();
    router.push(categoryHref(categoryQuery));
  };

  const wordmark = (
    <Tappable
      accessibilityRole="link"
      accessibilityLabel="Arro home"
      onPress={() => router.push("/")}
      className="min-h-11 justify-center px-1"
    >
      <Text
        className={`font-bold tracking-[-1px] text-arro-600 ${desktop ? "text-[26px] leading-8" : "text-[24px] leading-7"}`}
      >
        Arro
      </Text>
    </Tappable>
  );

  return (
    <Banner className="relative border-b border-line bg-white">
      <Shell className="py-2 md:py-3">
        {compact ? (
          <>
            <View className="flex-row items-center justify-between">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse categories"
                accessibilityState={{ expanded: categoriesOpen }}
                aria-expanded={categoriesOpen}
                onPress={() => setCategoriesOpen(true)}
                className="h-11 w-11 items-center justify-center rounded-full"
              >
                <Icon name="menu" size={23} />
              </Pressable>
              {wordmark}
              {compareCount > 0 ? (
                <HeaderEntry
                  icon="compare"
                  label="Compare"
                  count={compareCount}
                  active
                  showLabel={false}
                  onPress={() => router.push("/compare")}
                />
              ) : (
                <View className="h-11 w-11" />
              )}
            </View>

            {onHome ? null : (
              // A button, not a field. Tapping search on a phone opens the full
              // search surface with recent queries rather than a bare caret.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search products"
                onPress={onOpenSearch}
                className="mb-1 mt-1 min-h-11 flex-row items-center rounded-full bg-fill px-4"
              >
                <Icon name="search" size={18} color={color.ink600} />
                <Text
                  numberOfLines={1}
                  className={`ml-2.5 min-w-0 flex-1 text-[15px] ${query ? "text-ink-950" : "text-ink-400"}`}
                >
                  {query || "Search products"}
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          /* Search, and the one control that is about the person rather than
             the catalogue. Saved and cart live in the corner panel instead, so
             the header keeps a single job. The homepage already has a search
             field the size of a headline; repeating it here is clutter. */
          <View className="flex-row items-center gap-3">
            {wordmark}
            <Pressable
              nativeID="all-categories-trigger"
              accessibilityRole="button"
              accessibilityLabel="All categories"
              accessibilityState={{ expanded: categoriesOpen }}
              aria-expanded={categoriesOpen}
              {...(Platform.OS === "web"
                ? ({ "aria-controls": "desktop-category-menu" } as object)
                : {})}
              onHoverIn={holdOpen}
              onHoverOut={releaseOpen}
              onPress={toggleCategories}
              className={`min-h-10 shrink-0 flex-row items-center gap-1.5 rounded-full px-3 ${categoriesOpen ? "bg-fill" : ""}`}
            >
              <Text className="text-[16px] leading-6 text-ink-950">
                All categories
              </Text>
              <Icon
                name={categoriesOpen ? "chevronUp" : "chevronDown"}
                size={14}
                color={color.ink600}
              />
            </Pressable>
            <View className="min-w-0 flex-1 flex-row justify-end">
              {onHome ? null : (
                <View className="w-full max-w-[560px]">
                  <SearchField defaultValue={query} onSubmit={(next) => runSearch(next)} />
                </View>
              )}
            </View>
            <AccountEntry />
          </View>
        )}
      </Shell>

      {compact ? (
        <Sheet
          visible={categoriesOpen}
          title={drilled ? drilled.label : "Browse"}
          onClose={closeCategories}
        >
          <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
            <View className="pb-6">
              {drilled ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to all categories"
                    onPress={() => setDrilledInto(undefined)}
                    className="min-h-12 flex-row items-center gap-2 border-b border-line"
                  >
                    <Icon name="chevronLeft" size={17} color={color.ink600} />
                    <Text className="text-[14px] font-medium leading-5 text-ink-600">
                      All categories
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`All ${drilled.label}`}
                    onPress={() => openCategoryPage(drilled.query)}
                    className="min-h-14 flex-row items-center justify-between gap-3 border-b border-line"
                  >
                    <Text className="text-[15px] font-semibold leading-5 text-ink-950">{`All ${drilled.label}`}</Text>
                    <Icon name="arrowRight" size={16} color={color.ink400} />
                  </Pressable>
                  {drilled.children.map((child) => (
                    <Pressable
                      key={child.query}
                      accessibilityRole="link"
                      accessibilityLabel={child.label}
                      onPress={() => openCategory(child.query)}
                      className="min-h-14 flex-row items-center justify-between gap-3 border-b border-line"
                    >
                      <Text className="min-w-0 flex-1 text-[15px] leading-5 text-ink-950">
                        {child.label}
                      </Text>
                      <Icon
                        name="chevronRight"
                        size={16}
                        color={color.ink400}
                      />
                    </Pressable>
                  ))}
                </>
              ) : (
                browseCategories.map((category) => (
                  <Pressable
                    key={category.label}
                    accessibilityRole="button"
                    accessibilityLabel={`Browse ${category.label}`}
                    onPress={() => setDrilledInto(category)}
                    className="min-h-14 flex-row items-center justify-between gap-3 border-b border-line"
                  >
                    <View className="min-w-0 flex-1 flex-row items-center gap-3">
                      <View className="h-9 w-9 items-center justify-center rounded-full bg-fill">
                        <Icon
                          name={category.icon}
                          size={18}
                          color={color.arro700}
                        />
                      </View>
                      <Text className="text-[15px] font-medium leading-5 text-ink-950">
                        {category.label}
                      </Text>
                    </View>
                    <Icon name="chevronRight" size={17} color={color.ink400} />
                  </Pressable>
                ))
              )}
            </View>
          </ScrollView>
        </Sheet>
      ) : // A panel that drops out of the header, not a dialog parked over it. A
      // Modal renders from the top of the viewport, so the menu covered the
      // navbar that opened it — including the control the shopper was still
      // pointing at. Anchoring it to the header keeps the trigger visible and
      // the hover intact.
      categoriesOpen ? (
        <View
          nativeID="desktop-category-menu"
          role="navigation"
          aria-label="Product categories"
          onPointerEnter={holdOpen}
          onPointerLeave={releaseOpen}
          className="absolute left-0 right-0 top-full"
          style={{ zIndex: 60 }}
        >
          <Appear
            distance={-12}
            className="w-full border-b border-line bg-white shadow-lg"
          >
            <View className="mx-auto w-full max-w-[1680px] px-4 py-6 md:px-8 lg:px-10">
              <View className="flex-row items-start gap-10">
                <View className="w-[320px] border-r border-line pr-5">
                  {browseCategories.map((category) => {
                    const selected = category.query === active.query;
                    return (
                      <ProductLink
                        key={category.label}
                        href={categoryHref(category.query)}
                        label={category.label}
                        onIntent={() => {
                          setHovered(category);
                          loadTiles(category);
                        }}
                        onPress={closeCategories}
                        className={`min-h-12 flex-row items-center gap-3.5 rounded-xl px-3 ${selected ? "bg-fill" : ""}`}
                      >
                        <Icon
                          name={category.icon}
                          size={20}
                          color={selected ? color.arro600 : color.ink600}
                        />
                        <Text
                          className={`min-w-0 flex-1 text-[15px] leading-5 ${selected ? "font-semibold text-ink-950" : "text-ink-800"}`}
                        >
                          {category.label}
                        </Text>
                        <Icon
                          name="chevronRight"
                          size={15}
                          color={color.ink400}
                        />
                      </ProductLink>
                    );
                  })}
                </View>

                <View className="min-w-0 flex-1">
                  <View className="mb-4 flex-row items-center justify-between gap-4">
                    <Heading
                      level={2}
                      className="text-[18px] font-bold leading-6 text-ink-950"
                    >
                      {active.label}
                    </Heading>
                    <ProductLink
                      href={categoryHref(active.query)}
                      label={`All ${active.label}`}
                      onPress={closeCategories}
                      className="min-h-9 flex-row items-center gap-1 rounded-full px-2"
                    >
                      <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">
                        {`All ${active.label}`}
                      </Text>
                      <Icon name="arrowRight" size={14} color={color.arro700} />
                    </ProductLink>
                  </View>

                  {/* Picture-led like a catalogue, with the rest of the
                      level as plain links underneath. */}
                  <View className="-mx-2 flex-row flex-wrap">
                    {active.children.slice(0, 4).map((child) => (
                      <View key={child.query} className="w-1/4 px-2 pb-5 xl:w-1/4">
                        <ProductLink
                          href={searchHref(child.query)}
                          label={`Browse ${child.label}`}
                          onPress={() => {
                            recordQuery(child.query);
                            submitQuery(child.query);
                            closeCategories();
                          }}
                          className="arro-product gap-2.5"
                        >
                          <View className="aspect-[5/4] w-full items-center justify-center overflow-hidden rounded-2xl bg-fill-soft p-5">
                            {tiles[child.query] ? (
                              <ProductImage
                                uri={tiles[child.query]!}
                                alt=""
                                width={220}
                                className="h-full w-full"
                              />
                            ) : (
                              <Icon name={active.icon} size={26} color={color.ink400} />
                            )}
                          </View>
                          <Text numberOfLines={1} className="text-[15px] font-semibold leading-5 text-ink-950">
                            {child.label}
                          </Text>
                        </ProductLink>
                      </View>
                    ))}
                  </View>

                  {active.children.length > 4 ? (
                    <View className="flex-row flex-wrap gap-y-1 border-t border-line pt-3">
                      {active.children.slice(4).map((child) => (
                        <ProductLink
                          key={child.query}
                          href={searchHref(child.query)}
                          label={child.label}
                          onPress={() => {
                            recordQuery(child.query);
                            submitQuery(child.query);
                            closeCategories();
                          }}
                          className="min-h-9 w-1/4 justify-center pr-4"
                        >
                          <Text numberOfLines={1} className="arro-underline self-start text-[14px] leading-5 text-ink-800">
                            {child.label}
                          </Text>
                        </ProductLink>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </Appear>
        </View>
      ) : null}
    </Banner>
  );
}
