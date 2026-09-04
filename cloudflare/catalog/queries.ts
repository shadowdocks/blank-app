/**
 * Focused GraphQL queries for IMDb catalog.
 * Contains only the fields Hawk screens consume.
 */

export const TITLE_DETAIL_QUERY = `query TitleDetail($id: ID!, $castFirst: Int!, $similarFirst: Int!) {
  title(id: $id) {
    id
    titleText { text }
    originalTitleText { text }
    titleType { id text }
    releaseYear { year }
    releaseDate { day month year }
    runtime { seconds }
    ratingsSummary { aggregateRating voteCount }
    metacritic { metascore { score } }
    certificate { rating ratingReason }
    genres { genres { id text } }
    plot { plotText { plainText } }
    countriesOfOrigin { countries { id text } }
    spokenLanguages { spokenLanguages { id text } }
    primaryImage { url width height }
    images(first: 12) {
      edges { node { url width height } }
    }
    latestTrailer { id name { value } runtime { value } }
    credits(first: $castFirst) {
      edges {
        node {
          category { id text }
          ... on Cast {
            characters {
              name
            }
          }
          name { id nameText { text } primaryImage { url } }
        }
      }
    }
    moreLikeThisTitles(first: $similarFirst) {
      edges {
        node {
          id
          titleText { text }
          titleType { id text }
          releaseYear { year }
          ratingsSummary { aggregateRating voteCount }
          primaryImage { url }
        }
      }
    }
    episodes {
      displayableSeasons(first: 100) {
        edges {
          node {
            season
            displayableProperty { value { plainText } }
          }
        }
      }
    }
  }
}`;

export const EPISODES_QUERY = `query Episodes($id: ID!, $first: Int!, $after: ID, $filter: EpisodesFilter) {
  title(id: $id) {
    id
    titleText { text }
    episodes {
      isOngoing
      displayableSeasons(first: 100) {
        edges {
          node {
            id
            season
            displayableProperty { value { plainText } }
          }
        }
      }
      episodes(first: $first, after: $after, filter: $filter) {
        total
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            id
            titleText { text }
            releaseDate { day month year }
            ratingsSummary { aggregateRating voteCount }
            series { episodeNumber { seasonNumber episodeNumber } }
          }
        }
      }
    }
  }
}`;

export const DISCOVER_QUERY = `query Discover($first: Int!, $after: String, $constraints: AdvancedTitleSearchConstraints) {
  advancedTitleSearch(first: $first, after: $after, sort: { sortBy: POPULARITY, sortOrder: ASC }, constraints: $constraints) {
    total
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    edges {
      cursor
      node {
        title {
          id
          titleText { text }
          releaseYear { year }
          titleType { id text }
          ratingsSummary { aggregateRating voteCount }
          genres { genres { id text } }
          primaryImage { url width height }
        }
      }
    }
  }
}`;
