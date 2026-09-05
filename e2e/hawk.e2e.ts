import { expect, test } from "./fixtures/hawk"

test("home hero opens a title dialog", async ({ hawkPage: page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { level: 1, name: "The Matrix" })).toBeVisible()
  await expect(page.getByRole("article").filter({ hasText: "Arrival" })).toContainText(/7\.9.*2016.*Film/)

  await page.getByRole("button", { name: "Show Silo" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Silo" })).toBeVisible()
  await page.getByRole("link", { name: "Details" }).click()

  await expect(page).toHaveURL(/\/title\/tt14688458$/)
  await expect(page.getByRole("dialog")).toContainText("Silo test synopsis")
  await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Freedom Day/ }).locator("img")).toBeVisible()
})

test("settings persist device preferences", async ({ hawkPage: page }) => {
  await page.goto("/settings")
  const autoplay = page.getByRole("switch", { name: "Autoplay" })

  await expect(autoplay).toBeChecked()
  await autoplay.click()
  await expect(autoplay).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole("switch", { name: "Autoplay" })).not.toBeChecked()
})

test("watch keeps controls available and falls back from an actual MKV", async ({ hawkPage: page, hawkApi }) => {
  await page.goto("/watch/tt14688458/1/1")

  await expect(page.getByRole("button", { name: "Back" })).toBeVisible()
  await expect(page.getByText(/720p.*MP4.*AAC/)).toBeVisible()
  await expect.poll(() => hawkApi.playbackSourceIds).toEqual(["mkv-source", "mp4-source"])
  expect(hawkApi.deletedPlaybackIds).toEqual(["playback-mkv"])
  expect(new URL(hawkApi.sourceRequestUrls[0]!).searchParams.get("supportedAudioCodecs")).toContain("aac")

  const layout = await page.evaluate(() => ({
    hasHeader: Boolean(document.querySelector("header")),
    viewport: window.innerHeight,
    pageHeight: document.documentElement.scrollHeight,
  }))
  expect(layout.hasHeader).toBe(false)
  expect(layout.pageHeight).toBe(layout.viewport)
})
