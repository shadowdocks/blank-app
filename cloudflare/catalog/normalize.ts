import type {
  CastMember,
  EpisodePage,
  EpisodeSummary,
  MediaDetails,
  MediaSummary,
  MediaType,
  MediaVideo,
  SeasonSummary,
} from "../../src/shared/media";

export function imdbImage(url: string | null | undefined, width = 500): string | null {
  if (!url) return null;
  if (/._V1_.*\.jpg$/i.test(url)) {
    return url.replace(/._V1_.*\.jpg$/i, `._V1_QL75_UX${width}_.jpg`);
  }
  return url;
}

export function determineMediaType(typeStr: string | null | undefined): MediaType {
  if (!typeStr) return "movie";
  const lower = typeStr.toLowerCase();
  if (
    lower.includes("tvseries") ||
    lower.includes("tv_series") ||
    lower.includes("tvminiseries") ||
    lower.includes("tv_miniseries") ||
    lower.includes("series") ||
    lower === "tv"
  ) {
    return "tv";
  }
  return "movie";
}

export function formatReleaseDate(
  dateObj: { day?: number | null; month?: number | null; year?: number | null } | null | undefined
): string | null {
  if (!dateObj || !dateObj.year) return null;
  const { year, month, day } = dateObj;
  if (month && day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (month) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return String(year);
}

export interface SuggestionItem {
  id?: string;
  l?: string;
  y?: number;
  q?: string;
  qid?: string;
  rank?: number;
  s?: string;
  i?: {
    imageUrl?: string;
    width?: number;
    height?: number;
  };
}

export function normalizeSuggestionItem(item: SuggestionItem): MediaSummary | null {
  if (!item.id || !/^tt\d+$/.test(item.id)) return null;
  const mediaType = determineMediaType(item.qid || item.q);
  return {
    id: item.id,
    imdbId: item.id,
    tmdbId: null,
    mediaType,
    title: item.l || "Unknown",
    originalTitle: null,
    year: typeof item.y === "number" ? item.y : null,
    endYear: null,
    rating: null,
    voteCount: null,
    genres: [],
    posterUrl: imdbImage(item.i?.imageUrl, 500),
    backdropUrl: null,
  };
}

export interface TitleNode {
  id: string;
  titleText?: { text?: string } | null;
  originalTitleText?: { text?: string } | null;
  releaseYear?: { year?: number | null; endYear?: number | null } | null;
  releaseDate?: { day?: number | null; month?: number | null; year?: number | null } | null;
  runtime?: { seconds?: number | null } | null;
  titleType?: { id?: string | null; text?: string | null } | null;
  ratingsSummary?: { aggregateRating?: number | null; voteCount?: number | null } | null;
  metacritic?: { metascore?: { score?: number | null } | null } | null;
  certificate?: { rating?: string | null; ratingReason?: string | null } | null;
  genres?: { genres?: Array<{ id?: string | null; text?: string | null }> } | null;
  plot?: { plotText?: { plainText?: string | null } | null } | null;
  countriesOfOrigin?: { countries?: Array<{ id?: string | null; text?: string | null }> } | null;
  spokenLanguages?: { spokenLanguages?: Array<{ id?: string | null; text?: string | null }> } | null;
  primaryImage?: { url?: string | null; width?: number | null; height?: number | null } | null;
  images?: {
    edges?: Array<{
      node?: { url?: string | null; width?: number | null; height?: number | null; type?: string | null } | null;
    }>;
  } | null;
  latestTrailer?: {
    id?: string | null;
    name?: { value?: string | null } | null;
    runtime?: { value?: number | null } | null;
  } | null;
  credits?: {
    edges?: Array<{
      node?: {
        category?: { id?: string | null; text?: string | null } | null;
        characters?: Array<{ name?: string | null } | null> | null;
        name?: {
          id?: string | null;
          nameText?: { text?: string | null } | null;
          primaryImage?: { url?: string | null } | null;
        } | null;
      } | null;
    }>;
  } | null;
  moreLikeThisTitles?: {
    edges?: Array<{
      node?: {
        id: string;
        titleText?: { text?: string } | null;
        titleType?: { id?: string | null; text?: string | null } | null;
        releaseYear?: { year?: number | null } | null;
        ratingsSummary?: { aggregateRating?: number | null; voteCount?: number | null } | null;
        genres?: { genres?: Array<{ id?: string | null; text?: string | null }> } | null;
        primaryImage?: { url?: string | null } | null;
      } | null;
    }>;
  } | null;
  episodes?: {
    isOngoing?: boolean | null;
    displayableSeasons?: {
      edges?: Array<{
        node?: {
          id?: string | null;
          season?: string | number | null;
          displayableProperty?: { value?: { plainText?: string | null } | null } | null;
        } | null;
      }>;
    } | null;
    episodes?: {
      total?: number;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
      edges?: Array<{
        cursor?: string;
        node?: {
          id: string;
          titleText?: { text?: string } | null;
          releaseDate?: { day?: number | null; month?: number | null; year?: number | null } | null;
          ratingsSummary?: { aggregateRating?: number | null; voteCount?: number | null } | null;
          series?: {
            episodeNumber?: {
              seasonNumber?: number | string | null;
              episodeNumber?: number | string | null;
            } | null;
          } | null;
          primaryImage?: { url?: string | null; width?: number | null; height?: number | null; type?: string | null } | null;
          images?: {
            edges?: Array<{
              node?: { url?: string | null; width?: number | null; height?: number | null; type?: string | null } | null;
            }>;
          } | null;
        } | null;
      }>;
    } | null;
  } | null;
}

export function normalizeBackdrop(node: Pick<TitleNode, "images">): string | null {
  const candidates = (node.images?.edges ?? [])
    .flatMap(({ node: image }) => image?.url && image.width && image.height && image.width / image.height >= 1.5 ? [image] : []);
  const stills = candidates.filter((image) => image.type?.toLowerCase() === "still_frame");
  const untyped = candidates.filter((image) => !image.type);
  const backdrop = (stills.length ? stills : untyped)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  return imdbImage(backdrop?.url, 1280);
}

export interface EpisodeImageCandidate {
  url?: string | null;
  width?: number | null;
  height?: number | null;
  type?: string | null;
}

export function normalizeEpisodeThumbnail(node: {
  primaryImage?: EpisodeImageCandidate | null;
  images?: {
    edges?: Array<{
      node?: EpisodeImageCandidate | null;
    }>;
  } | null;
}): string | null {
  const images = (node.images?.edges ?? [])
    .flatMap(({ node: img }) => (img?.url ? [img] : []));

  const isPublicityOrEvent = (img: EpisodeImageCandidate) => {
    const type = img.type?.toLowerCase();
    return type === "publicity" || type === "event";
  };

  // 1. Prefer proper episode stills
  const stills = images.filter((img) => img.type?.toLowerCase() === "still_frame");
  if (stills.length > 0) {
    const sortedStills = [...stills].sort((a, b) => {
      const aLandscape = a.width && a.height ? a.width >= a.height : true;
      const bLandscape = b.width && b.height ? b.width >= b.height : true;
      if (aLandscape && !bLandscape) return -1;
      if (!aLandscape && bLandscape) return 1;
      return (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
    });
    return imdbImage(sortedStills[0].url, 500);
  }

  // Set of URLs known to be publicity or event photos
  const publicityUrls = new Set(
    images.filter(isPublicityOrEvent).map((img) => img.url)
  );

  // 2. Evaluate primaryImage if present
  const primary = node.primaryImage;
  if (primary?.url) {
    // Never select publicity or event photos
    if (!isPublicityOrEvent(primary) && !publicityUrls.has(primary.url)) {
      const primaryType = primary.type?.toLowerCase();
      const isPoster = primaryType === "poster";
      const isPortraitPoster =
        primary.width && primary.height ? primary.height > primary.width * 1.2 : false;

      // Don't select posters as episode stills
      if (!isPoster && !isPortraitPoster) {
        return imdbImage(primary.url, 500);
      }
    }
  }

  // 3. Fall back to untyped images in images connection if landscape and not publicity/event
  const untypedLandscape = images.filter(
    (img) =>
      !img.type &&
      !publicityUrls.has(img.url) &&
      img.width &&
      img.height &&
      img.width >= img.height
  );
  if (untypedLandscape.length > 0) {
    const sorted = [...untypedLandscape].sort(
      (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
    );
    return imdbImage(sorted[0].url, 500);
  }

  // 4. No proper still exists - preserve null so UI can fallback to show artwork
  return null;
}

export function normalizeMediaSummary(node: TitleNode): MediaSummary {
  const genres =
    node.genres?.genres
      ?.map((g) => g.text || g.id)
      .filter((g): g is string => typeof g === "string" && g.length > 0) ?? [];

  return {
    id: node.id,
    imdbId: node.id,
    tmdbId: null,
    mediaType: determineMediaType(node.titleType?.id || node.titleType?.text),
    title: node.titleText?.text || "Unknown",
    originalTitle: node.originalTitleText?.text ?? null,
    year: node.releaseYear?.year ?? null,
    endYear: node.releaseYear?.endYear ?? null,
    rating: node.ratingsSummary?.aggregateRating ?? null,
    voteCount: node.ratingsSummary?.voteCount ?? null,
    genres,
    posterUrl: imdbImage(node.primaryImage?.url, 500),
    backdropUrl: null,
  };
}

export function normalizeTitleDetail(
  node: TitleNode,
  fallback?: Partial<MediaDetails>
): MediaDetails {
  const summary = normalizeMediaSummary(node);

  const countries =
    node.countriesOfOrigin?.countries
      ?.map((c) => c.text || c.id)
      .filter((c): c is string => typeof c === "string" && c.length > 0) ?? [];

  const languages =
    node.spokenLanguages?.spokenLanguages
      ?.map((l) => l.text || l.id)
      .filter((l): l is string => typeof l === "string" && l.length > 0) ?? [];

  const rawCredits = node.credits?.edges ?? [];
  const cast: CastMember[] = rawCredits.flatMap(({ node: creditNode }) => {
    if (!creditNode?.name?.id || !creditNode.name.nameText?.text) return [];
    const character =
      creditNode.characters
        ?.map((c) => c?.name?.trim())
        .filter((name): name is string => Boolean(name))
        .join(" / ") || null;
    return [
      {
        id: creditNode.name.id,
        name: creditNode.name.nameText.text,
        character,
        imageUrl: imdbImage(creditNode.name.primaryImage?.url, 300),
      },
    ];
  });

  const trailer: MediaVideo | null = node.latestTrailer?.id
    ? {
        id: node.latestTrailer.id,
        title: node.latestTrailer.name?.value || "Trailer",
        type: "Trailer",
        url: `https://www.imdb.com/video/${node.latestTrailer.id}`,
        thumbnailUrl: null,
        durationSeconds: node.latestTrailer.runtime?.value ?? null,
      }
    : null;

  const rawSimilar = node.moreLikeThisTitles?.edges ?? [];
  const similar: MediaSummary[] = rawSimilar.flatMap(({ node: simNode }) => {
    if (!simNode?.id) return [];
    const item: MediaSummary = {
      id: simNode.id,
      imdbId: simNode.id,
      tmdbId: null,
      mediaType: determineMediaType(simNode.titleType?.id),
      title: simNode.titleText?.text || "Unknown",
      originalTitle: null,
      year: simNode.releaseYear?.year ?? null,
      endYear: null,
      rating: simNode.ratingsSummary?.aggregateRating ?? null,
      voteCount: simNode.ratingsSummary?.voteCount ?? null,
      genres:
        simNode.genres?.genres
          ?.map((g) => g.text || g.id)
          .filter((g): g is string => typeof g === "string") ?? [],
      posterUrl: imdbImage(simNode.primaryImage?.url, 500),
      backdropUrl: null,
    };
    return [item];
  });

  const rawSeasons = node.episodes?.displayableSeasons?.edges ?? [];
  const seasons: SeasonSummary[] = rawSeasons
    .flatMap(({ node: sNode }) => {
      if (!sNode?.season) return [];
      const seasonNum = Number(sNode.season);
      if (!Number.isFinite(seasonNum) || seasonNum < 1) return [];
      const title = sNode.displayableProperty?.value?.plainText || `Season ${seasonNum}`;
      const seasonItem: SeasonSummary = {
        season: seasonNum,
        title,
        episodeCount: null,
        year: null,
      };
      return [seasonItem];
    })
    .sort((a, b) => a.season - b.season);

  const runtimeMinutes = node.runtime?.seconds
    ? Math.round(node.runtime.seconds / 60)
    : fallback?.runtimeMinutes ?? null;

  return {
    ...summary,
    tmdbId: fallback?.tmdbId ?? null,
    backdropUrl: normalizeBackdrop(node) ?? fallback?.backdropUrl ?? null,
    overview: node.plot?.plotText?.plainText ?? fallback?.overview ?? null,
    runtimeMinutes,
    releaseDate: formatReleaseDate(node.releaseDate) ?? fallback?.releaseDate ?? null,
    certification: node.certificate?.rating ?? fallback?.certification ?? null,
    metacriticScore: node.metacritic?.metascore?.score ?? null,
    countries,
    languages,
    cast: cast.length > 0 ? cast : fallback?.cast ?? [],
    trailer: trailer ?? fallback?.trailer ?? null,
    similar: similar.length > 0 ? similar : fallback?.similar ?? [],
    seasons: seasons.length > 0 ? seasons : fallback?.seasons ?? [],
  };
}

export function normalizeEpisodes(
  node: TitleNode,
  targetSeason: number,
  fallbackEpisodes?: EpisodeSummary[]
): EpisodePage {
  const seriesId = node.id;
  const rawEpisodes = node.episodes?.episodes?.edges ?? [];

  const matching: EpisodeSummary[] = rawEpisodes
    .flatMap(({ node: epNode }) => {
      if (!epNode?.id) return [];
      const epSeason = Number(epNode.series?.episodeNumber?.seasonNumber);
      const epNumber = Number(epNode.series?.episodeNumber?.episodeNumber);
      if (epSeason !== targetSeason || !Number.isFinite(epNumber)) return [];

      const ep: EpisodeSummary = {
        id: epNode.id,
        imdbId: epNode.id,
        title: epNode.titleText?.text || `Episode ${epNumber}`,
        season: epSeason,
        episode: epNumber,
        overview: null,
        releaseDate: formatReleaseDate(epNode.releaseDate),
        runtimeMinutes: null,
        rating: epNode.ratingsSummary?.aggregateRating ?? null,
        voteCount: epNode.ratingsSummary?.voteCount ?? null,
        imageUrl: normalizeEpisodeThumbnail(epNode),
      };
      return [ep];
    })
    .sort((a, b) => a.episode - b.episode);

  if (matching.length === 0 && fallbackEpisodes && fallbackEpisodes.length > 0) {
    return {
      seriesId,
      season: targetSeason,
      results: fallbackEpisodes,
      nextCursor: null,
    };
  }

  return {
    seriesId,
    season: targetSeason,
    results: matching,
    nextCursor: null,
  };
}
