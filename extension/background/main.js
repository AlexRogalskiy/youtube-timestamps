import * as youtubei from './youtubei.js'
import * as googleapis from './googleapis.js'
import { findTimestamps, parseTimestamp } from './timestamp.js'

const MAX_TEXT_LENGTH = 128

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type == 'fetchTimeComments') {
        fetchTimeComments(request.videoId)
            .then(sendResponse)
            .catch(e => {
                console.error(e)
            })
        return true
    }
})

async function fetchTimeComments(videoId) {
    const comments = await fetchComments(videoId)
    const timeComments = []
    for (const comment of comments) {
        for (const tsContext of getTimestampContexts(comment.text)) {
            timeComments.push(newTimeComment(comment.authorAvatar, comment.authorName, tsContext))
        }
    }
    return timeComments
}

async function fetchComments(videoId) {
    try {
        return await fetchCommentsYoutubei(videoId)
    } catch (e) {
        console.error(e)
        return await fetchCommentsGoogleapis(videoId)
    }
}

async function fetchCommentsYoutubei(videoId) {
    const videoResponse = await youtubei.fetchVideo(videoId)
    const commentsContinuation = videoResponse[3].response.contents.twoColumnWatchNextResults.results.results
        .contents[2].itemSectionRenderer
        .contents[0].continuationItemRenderer.continuationEndpoint.continuationCommand.token
    const commentsResponse = await youtubei.fetchNext(commentsContinuation)
    const items = commentsResponse.onResponseReceivedEndpoints[1].reloadContinuationItemsCommand.continuationItems
    const comments = []
    for (const item of items) {
        if (item.commentThreadRenderer) {
            const cr = item.commentThreadRenderer.comment.commentRenderer
            const authorName = cr.authorText.simpleText
            const authorAvatar = cr.authorThumbnail.thumbnails[0].url
            const text = cr.contentText.runs
                .map(run => run.text)
                .join("")
            comments.push(newComment(authorName, authorAvatar, text))
        }
    }
    return comments
}

async function fetchCommentsGoogleapis(videoId) {
    const commentItems = await googleapis.fetchComments(videoId)
    const comments = []
    for (const item of commentItems) {
        const cs = item.snippet.topLevelComment.snippet
        comments.push(newComment(cs.authorDisplayName, cs.authorProfileImageUrl, cs.textOriginal))
    }
    return comments
}

function newComment(authorName, authorAvatar, text) {
    return {
        authorName,
        authorAvatar,
        text
    }
}

function newTimeComment(authorAvatar, authorName, tsContext) {
    return {
        authorAvatar,
        authorName,
        timestamp: tsContext.timestamp,
        time: tsContext.time,
        text: tsContext.text
    }
}

function getTimestampContexts(text) {
    const result = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line) {
            const positions = findTimestamps(line)
            for (const position of positions) {
                const timestamp = line.substring(position.from, position.to)
                const time = parseTimestamp(timestamp)
                if (time === null) {
                    continue
                }
                let contextText
                if (text.length > MAX_TEXT_LENGTH) {
                    if (timestamp === line && i + 1 < lines.length && lines[i + 1]) {
                        contextText = line + '\n' + lines[i + 1]
                    } else {
                        contextText = line
                    }
                } else {
                    contextText = text
                }
                result.push({
                    text: contextText,
                    time,
                    timestamp
                })
            }
        }
    }
    return result
}
