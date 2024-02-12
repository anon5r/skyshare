import { memo, useState, useContext, Dispatch, SetStateAction } from "react"
import { Session_context } from "../common/contexts"
import { type msgInfo, type modes, type xContent } from "../common/types"

import {
    buildRecordBase,
    attachImageToRecord,
    attachExternalToRecord,
    type SessionNecessary
} from "@/utils/recordBuilder";

import createRecord from "@/utils/atproto_api/createRecord";
import createPage from "@/utils/backend_api/createPage";

import { link } from "../common/tailwind_variants";

import { pagesPrefix } from "@/utils/vars";
import Tweetbox from "../common/Tweetbox"
import ImgForm from "./ImgForm"
import ImgViewBox from "./ImgViewBox"
import TextForm from "./TextForm"
import XPopup from "../xcom/xpopup"
import AutoXPopupToggle from "./AutoXPopupToggle"
import NoGenerateToggle from "./NoGenerateToggle"
import PostButton from "./PostButton"
import Details from "./Details"

const siteurl = location.origin
const MemoImgViewBox = memo(ImgViewBox)
const Component = ({
    setMsgInfo,
    processing,
    setProcessing,
    setMode,
    setXcontent
}: {
    processing: boolean,
    setProcessing: Dispatch<SetStateAction<boolean>>,
    setMsgInfo: Dispatch<SetStateAction<msgInfo>>,
    setMode: Dispatch<SetStateAction<modes>>,
    setXcontent: Dispatch<SetStateAction<xContent>>,
}) => {
    // ImgFormにて格納されるimageとディスパッチャー
    const [imageFiles, setImageFile] = useState<File[] | null>(null);
    // Post内容を格納する変数とディスパッチャー
    const [post, setPost] = useState<string>("")
    // Postの文字数を格納する変数とディスパッチャー
    const [count, setCount] = useState<number>(0)
    // ポスト時に自動でXを開く
    const [autoPop, setAutoPop] = useState<boolean>(false)
    // OGP画像を生成しない（Embedを有効にする）
    const [noGenerate, setNoGenerate] = useState<boolean>(false)
    // Postの実行状態を管理する変数とディスパッチャー
    const [isPostProcessing, setPostProcessing] = useState<boolean>(false)
    // セッション
    const { session } = useContext(Session_context)
    // Postの入力上限
    const countMax = 300

    const initializePost = () => {
        setPostProcessing(true)
        setProcessing(true)
        // Postを押したら強制的にフォーカスアウトイベントを発火
    }

    const handlePost = async () => {
        initializePost()
        setMsgInfo({
            msg: "レコードに変換中...",
            isError: false
        })
        try {
            let record = await buildRecordBase({
                text: post,
                createdAt: new Date()
            })
            let xContent: xContent = {
                url: "",
                content: post
            }
            // ボタンはログインしている前提で表示される
            if (session.accessJwt === null || session.did === null) {
                let e: Error = new Error("フロントエンドが想定していない操作が行われました。")
                e.name = "Unexpected Error@postform.tsx"
                throw e
            }
            const sessionNecessary: SessionNecessary = {
                did: session.did,
                accessJwt: session.accessJwt,
            }
            // 文字数が制限数を超えていた場合は終了
            if (count > countMax) {
                let e: Error = new Error("文字数制限を超えています。")
                e.name = "postform.tsx"
                throw e
            }
            const noImagesAttached = (imageFiles === null)
            // 画像のアップロードを行う場合の処理(Bluesky側)
            if (!noImagesAttached) {
                record = await attachImageToRecord({
                    base: record,
                    session: sessionNecessary,
                    imageFiles: imageFiles,
                    handleProcessing: setMsgInfo
                })
            }
            if (typeof record.facets !== "undefined" && record.facets.length > 0) {
                let linkcardUrl: string | null = null
                // メンションではなくリンクを検出する
                record.facets.forEach((value) => {
                    const facetObj = value.features[0]
                    if (facetObj.$type === "app.bsky.richtext.facet#link") {
                        linkcardUrl = facetObj.uri
                    }
                })
                if (linkcardUrl !== null) {
                    xContent.url = linkcardUrl
                    // 本文からはリンク対象の文字列を削除
                    xContent.content = post.replace(linkcardUrl, "")
                }
                if (linkcardUrl !== null) {
                    // OGPを生成する必要がない場合(!noGenerate but noImageAttached)
                    // またはOGPの生成を抑制している場合(noGenerate)で
                    // 外部リンクが添付されている場合はlinkcardを付与する
                    if((!noGenerate && noImagesAttached) || noGenerate) {
                        record = await attachExternalToRecord({
                            base: record,
                            session: sessionNecessary,
                            externalUrl: linkcardUrl,
                            handleProcessing: setMsgInfo
                        })
                    }
                }
            }
            setMsgInfo({
                msg: "Blueskyへポスト中...",
                isError: false
            })
            const rec_res = await createRecord({
                repo: session.did,
                accessJwt: session.accessJwt,
                record: record,
            })
            if (typeof rec_res?.error !== "undefined") {
                let e: Error = new Error(rec_res.message)
                e.name = rec_res.error
                throw e
            }
            setMsgInfo({
                msg: "Blueskyへポストしました!",
                isError: false
            })
            // noGenerateの場合はTwitter用ページは生成しない
            if (!noGenerate && !noImagesAttached) {
                setMsgInfo({
                    msg: "Twitter用ページ生成中...",
                    isError: false
                })
                const get_res = await createPage({
                    accessJwt: session.accessJwt,
                    uri: rec_res.uri
                })
                if (typeof get_res.uri !== "undefined") {
                    setMsgInfo({
                        msg: "Twitter用リンクを生成しました!",
                        isError: false
                    })
                    const [id, rkey] = get_res.uri.split("/")
                    xContent.url = new URL(`${pagesPrefix}/${id}@${rkey}/`, siteurl).toString()
                }
            }
            if (autoPop) {
                XPopup(xContent)
            }
            setXcontent(xContent)
            setMode("xcom")
            handlerCancel()
        } catch (error: unknown) {
            let msg: string = "Unexpected Unknown Error"
            if (error instanceof Error) {
                msg = error.name + ": " + error.message
            }
            setMsgInfo({
                msg: msg,
                isError: true
            })
        }
        setProcessing(false)
        setPostProcessing(false)
    }
    const handlerCancel = () => {
        setImageFile(null)
        setPost("")
        setCount(0)
    }
    const handleOnChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPost(event.target.value)
        try {
            const segmenterJa = new Intl.Segmenter('ja-JP', { granularity: 'grapheme' })
            const segments = segmenterJa.segment(event.currentTarget.value)
            setCount(Array.from(segments).length)
        } catch (e) {
            // Intl.Segmenterがfirefoxでは未対応であるため、やむをえずレガシーな方法で対処
            // 絵文字のカウント数が想定より多く設定されてしまうため、firefox_v125までは非推奨ブラウザとする
            setCount(event.currentTarget.value.length)
        }
    }

    return (
        <>
            <Tweetbox>
                <div className="flex">
                    <button
                        onClick={handlerCancel}
                        className={link({
                            enabled: (post.length >= 1 || imageFiles !== null),
                            class: "inline-block mx-2"
                        })}
                        disabled={!(post.length >= 1 || imageFiles !== null)}>
                        下書きを消す
                    </button>
                    <div className="flex-1 my-0"></div>
                    <PostButton
                        handlePost={handlePost}
                        isProcessing={processing}
                        isPostProcessing={isPostProcessing}
                        disabled={!(post.length >= 1 || imageFiles !== null)} />
                </div>
                <TextForm
                    post={post}
                    disabled={isPostProcessing}
                    onChange={handleOnChange} />
                <div className="flex">
                    <ImgForm
                        disabled={isPostProcessing}
                        setImageFile={setImageFile}
                        className="py-0"
                    />

                    <div className="flex-1"></div>
                    <div className={`align-middle my-auto mr-1 px-2 rounded-lg ${count > countMax && "bg-red-300"}`}>{count}/300</div>

                </div>

                <Details
                    initValue={!(autoPop || noGenerate)}>
                    <div className="flex flex-wrap">
                        <AutoXPopupToggle
                            labeltext={"Xを自動で開く"}
                            prop={autoPop}
                            setProp={setAutoPop} />
                        <NoGenerateToggle
                            labeltext={<>
                                Xへの投稿画像は自身で添付する
                            </>}
                            prop={noGenerate}
                            setProp={setNoGenerate} />
                    </div>
                </Details>
                <MemoImgViewBox
                    imageFiles={imageFiles} />
            </Tweetbox>
        </>
    );
}

export default Component