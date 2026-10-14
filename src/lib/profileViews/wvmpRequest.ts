// LinkedIn WVMP ("who viewed my profile") data call. The count lives ONLY in this
// SDUI server-request response — there is no clean voyager JSON endpoint. Verified
// live: this POST from the extension origin (csrf-token + credentials:'include')
// returns 200 with the count, needing no tab navigation. Request body is a fixed
// SDUI template captured from the real page (no tokens/PII — asserted at gen time).

export const WVMP_URL =
  'https://www.linkedin.com/flagship-web/rsc-action/actions/server-request?sduiid=WvmpAnalytics';

export const WVMP_REQUEST_BODY =
  '{"requestId":"WvmpAnalytics","serverRequest":{"requestId":"WvmpAnalytics","requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","payload":{"filterTypeList":[],"highlightCardDimensions":["DimensionType_LOCATION","DimensionType_INDUSTRY","DimensionType_ORGANIZATION"],"detailsCardDimensions":["DimensionType_ORGANIZATION"],"highlightCardResultCount":4,"detailsCardResultCount":23},"requestedStateKeys":[],"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"}},"onClientRequestFailureAction":{"actions":[{"$type":"proto.sdui.actions.core.SetState","value":{"state":{"key":{"key":{"value":{"$case":"id","id":"wvmpMainHeaderDisappeared"}}},"value":{"$case":"booleanValue","booleanValue":true}}}}]},"isApfcEnabled":false,"isStreaming":false,"rumPageKey":""},"states":[],"requestedArguments":{"$type":"proto.sdui.actions.requests.RequestedArguments","payload":{"filterTypeList":[],"highlightCardDimensions":["DimensionType_LOCATION","DimensionType_INDUSTRY","DimensionType_ORGANIZATION"],"detailsCardDimensions":["DimensionType_ORGANIZATION"],"highlightCardResultCount":4,"detailsCardResultCount":23},"requestedStateKeys":[],"requestMetadata":{"$type":"proto.sdui.common.RequestMetadata"},"states":[],"screenId":"com.linkedin.sdui.flagshipnav.home.Home"}}';
